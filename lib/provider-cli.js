import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { addProvider, getProvider, listProviders, removeProvider, setActiveProvider, testProvider, upsertProvider } from './provider-manager.js';

function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function maskKey(key = '') {
  if (!key) return '(none)';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function printProvider(provider) {
  const active = provider.id === provider.activeProvider ? color(32, '●') : ' ';
  const status = provider.lastTest?.status === 'ok'
    ? color(32, 'ok')
    : provider.lastTest?.status === 'error'
      ? color(31, 'error')
      : color(90, 'untested');
  console.log(`${active} ${provider.id.padEnd(16)} ${provider.name.padEnd(18)} ${provider.type.padEnd(22)} ${provider.baseUrl || '(no url)'}  ${status}`);
}

async function ask(rl, label, { defaultValue = '', secret = false } = {}) {
  const suffix = defaultValue ? color(90, ` [${defaultValue}]`) : '';
  const answer = secret
    ? await rl.question(`${label}${suffix}: `)
    : await rl.question(`${label}${suffix}: `);
  const trimmed = String(answer || '').trim();
  return trimmed || defaultValue;
}

async function chooseType(rl, current = 'openai-compatible') {
  const options = ['openai-compatible', 'anthropic', 'local'];
  console.log('\n  Provider type:');
  options.forEach((opt, i) => {
    const hint = opt === 'openai-compatible'
      ? 'OpenAI-compatible /v1 endpoint'
      : opt === 'anthropic'
        ? 'Anthropic API'
        : 'Local model server';
    console.log(`  ${i + 1}. ${opt.padEnd(22)} ${hint}`);
  });
  const raw = await rl.question(`Select type [${current}]: `);
  const n = Number(raw.trim());
  if (!raw.trim()) return current;
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
  if (options.includes(raw.trim())) return raw.trim();
  return current;
}

function printList() {
  const providers = listProviders();
  const active = providers.find(p => p.id === (providers.find(p => p.id === 'opencode')?.activeProvider));
  console.log('\n  Providers\n');
  console.log(`  ${'ID'.padEnd(18)} ${'Name'.padEnd(18)} ${'Type'.padEnd(22)} URL`);
  console.log(`  ${'-'.repeat(18)} ${'-'.repeat(18)} ${'-'.repeat(22)} ${'-'.repeat(40)}`);
  for (const provider of providers) {
    printProvider(provider);
  }
  console.log();
}

export async function runProviderCLI(argv = []) {
  const [command, ...rest] = argv;
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    switch (command) {
      case 'list': {
        const providers = listProviders();
        const activeId = providers.find(p => p.id && p.id === (providers.find(p => p.id) && p.id));
        console.log('\n  Providers\n');
        console.log(`  ${'ID'.padEnd(18)} ${'Name'.padEnd(18)} ${'Type'.padEnd(22)} URL`);
        console.log(`  ${'-'.repeat(18)} ${'-'.repeat(18)} ${'-'.repeat(22)} ${'-'.repeat(40)}`);
        for (const provider of providers) {
          const marker = provider.id === (provider?.activeProvider) ? color(32, '●') : ' ';
          console.log(`${marker} ${provider.id.padEnd(16)} ${provider.name.padEnd(18)} ${provider.type.padEnd(22)} ${provider.baseUrl || '(no url)'}`);
        }
        console.log();
        break;
      }

      case 'set': {
        const id = rest[0];
        if (!id) throw new Error('Usage: mizi provider set <id>');
        const provider = setActiveProvider(id);
        console.log(`\n  ${color(32, '✓')} Active provider set to ${color(1, provider.name)} (${provider.id})\n`);
        break;
      }

      case 'test': {
        const id = rest[0];
        if (!id) throw new Error('Usage: mizi provider test <id>');
        process.stdout.write(`\n  Testing ${id}... `);
        const result = await testProvider(id);
        if (result.ok) {
          console.log(color(32, 'ok'));
          console.log(`  ${result.message}`);
          console.log(`  latency: ${result.latencyMs}ms`);
          console.log(`  models: ${result.modelsCount}`);
        } else {
          console.log(color(31, 'failed'));
          console.log(`  ${result.message}`);
        }
        console.log();
        break;
      }

      case 'delete': {
        const id = rest[0];
        if (!id) throw new Error('Usage: mizi provider delete <id>');
        const hard = rest.includes('--hard');
        const provider = getProvider(id);
        if (!provider) throw new Error(`Provider "${id}" not found`);
        const answer = await ask(rl, `Delete provider ${id}? (y/N)`, { defaultValue: 'n' });
        if (!/^y(es)?$/i.test(answer)) {
          console.log('  cancelled\n');
          break;
        }
        const ok = removeProvider(id, { hard });
        console.log(ok ? `  ${color(32, '✓')} removed ${id}\n` : `  ${color(31, 'failed')} could not remove ${id}\n`);
        break;
      }

      case 'add':
      case 'edit': {
        const editingId = command === 'edit' ? rest[0] : null;
        const current = editingId ? getProvider(editingId) : null;
        if (editingId && !current) throw new Error(`Provider "${editingId}" not found`);

        console.log('\n  Provider setup wizard\n');
        const type = await chooseType(rl, current?.type || 'openai-compatible');
        const name = await ask(rl, 'Provider name', { defaultValue: current?.name || 'OpenCode Zen' });
        const baseUrlDefault = type === 'anthropic'
          ? 'https://api.anthropic.com/v1'
          : current?.baseUrl || 'https://openrouter.ai/api/v1';
        const baseUrl = await ask(rl, 'Base URL', { defaultValue: baseUrlDefault });
        const apiKey = await ask(rl, 'API key', { defaultValue: current?.apiKey || '', secret: true });
        const modelsRaw = await ask(rl, 'Model IDs (comma-separated)', { defaultValue: current?.models?.join(', ') || '' });
        const enabledAnswer = await ask(rl, 'Enable provider? (Y/n)', { defaultValue: 'y' });
        const enabled = !/^n(o)?$/i.test(enabledAnswer);

        const record = {
          name,
          type,
          baseUrl,
          apiKey,
          models: modelsRaw.split(',').map(s => s.trim()).filter(Boolean),
          enabled,
        };

        const id = editingId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider';
        if (editingId) {
          upsertProvider(editingId, record);
        } else {
          addProvider({ ...record, id });
        }

        console.log(`\n  ${color(32, '✓')} Saved provider ${color(1, name)}\n`);
        const activeAnswer = await ask(rl, 'Set as active provider? (Y/n)', { defaultValue: 'y' });
        if (!/^n(o)?$/i.test(activeAnswer)) {
          setActiveProvider(editingId || id);
          console.log(`  ${color(32, '✓')} active provider updated\n`);
        }

        const testAnswer = await ask(rl, 'Test provider now? (Y/n)', { defaultValue: 'y' });
        if (!/^n(o)?$/i.test(testAnswer)) {
          const result = await testProvider(editingId || id);
          if (result.ok) {
            console.log(`  ${color(32, '✓')} ${result.message}`);
            console.log(`  ${result.latencyMs}ms • ${result.modelsCount} models\n`);
          } else {
            console.log(`  ${color(31, '✗')} ${result.message}\n`);
          }
        }
        break;
      }

      default: {
        console.log('\n  Provider commands\n');
        console.log('    mizi provider list');
        console.log('    mizi provider add');
        console.log('    mizi provider edit <id>');
        console.log('    mizi provider set <id>');
        console.log('    mizi provider test <id>');
        console.log('    mizi provider delete <id> [--hard]\n');
      }
    }
  } finally {
    rl.close();
  }
}
