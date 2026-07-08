import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { streamChat, EFFORTS, REASONING_LEVELS, fetchModels } from './ai.js';
import { getPermissionMode, PERMISSION_MODES } from './permissions.js';
import { executeTool } from './tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SYSTEM_PROMPT = `You are Mizi, a helpful AI coding assistant running in the user's terminal. You have access to tools for file operations and running commands.

Available tools:
- read_file(path): Read a file's contents
- write_file(path, content): Create or overwrite a file
- edit_file(path, old_text, new_text): Find and replace text in a file
- list_files(path): List files in a directory
- run_command(command): Run a shell command

When you need to use a tool, output your response as a JSON tool call in this exact format:
<tool_use>{"name": "tool_name", "args": {"param": "value"}}</tool_use>

You can make multiple tool calls. After tool results are returned, continue your response.
Be concise and helpful. Use markdown formatting in your responses.`;

let messages = [];
let busy = false;

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: line => {
    const cmds = Object.keys(SLASH_COMMANDS);
    const hits = cmds.filter(c => c.startsWith(line));
    return [hits.length ? hits : cmds, line];
  },
});

// ── Core REPL ──

export function startREPL() {
  printBanner();
  prompt();
}

function printBanner() {
  const mode = getPermissionMode();
  const effort = config.get('effort');
  const model = config.get('model') || '(none)';
  console.log();
  console.log('\x1b[1m\x1b[36m  ╔══════════════════════════════════════╗');
  console.log('  ║          \x1b[37m✦ MIZI CLI ✦\x1b[36m               ║');
  console.log('  ╚══════════════════════════════════════╝\x1b[0m');
  console.log(`  \x1b[90mModel:\x1b[0m ${model}  \x1b[90mEffort:\x1b[0m ${effort}  \x1b[90mPerm:\x1b[0m ${mode}`);
  console.log(`  \x1b[90mType /help for commands, /model to select a model\x1b[0m`);
  console.log();
}

function prompt() {
  rl.question('\x1b[1m\x1b[36m❯\x1b[0m ', async input => {
    const trimmed = input.trim();
    if (!trimmed) { prompt(); return; }

    if (trimmed.startsWith('/')) {
      await handleSlash(trimmed);
      prompt();
      return;
    }

    messages.push({ role: 'user', content: trimmed });
    await streamResponse();
    prompt();
  });
}

async function streamResponse() {
  if (busy) return;
  busy = true;

  const systemMsg = { role: 'system', content: SYSTEM_PROMPT };
  const chatMsgs = [systemMsg, ...messages.slice(-20)];

  try {
    process.stdout.write('\n');
    let fullResponse = '';

    for await (const chunk of streamChat(chatMsgs)) {
      process.stdout.write(chunk);
      fullResponse += chunk;
    }

    process.stdout.write('\n\n');

    // Check for tool calls in the response
    const toolMatch = fullResponse.match(/<tool_use>(\{.*?\})<\/tool_use>/s);
    if (toolMatch) {
      try {
        const toolCall = JSON.parse(toolMatch[1]);
        process.stdout.write(`\x1b[90m🔧 Using tool: ${toolCall.name}\x1b[0m\n`);
        const result = await executeTool(toolCall.name, toolCall.args);
        messages.push({ role: 'assistant', content: fullResponse });
        messages.push({ role: 'user', content: `Tool result:\n${JSON.stringify(result, null, 2)}` });
        await streamResponse();
        return;
      } catch (e) {
        console.log(`\x1b[31mTool error: ${e.message}\x1b[0m`);
      }
    }

    messages.push({ role: 'assistant', content: fullResponse });
  } catch (e) {
    console.log(`\x1b[31mError: ${e.message}\x1b[0m\n`);
  }

  busy = false;
}

// ── Slash Commands ──

const SLASH_COMMANDS = {
  '/help':       { desc: 'Show available commands',        fn: cmdHelp },
  '/model':      { desc: 'Select or view current model',   fn: cmdModel },
  '/models':     { desc: 'List available models',          fn: cmdModels },
  '/provider':   { desc: 'Switch or add providers',        fn: cmdProvider },
  '/effort':     { desc: 'Set effort level',               fn: cmdEffort },
  '/reasoning':  { desc: 'Set reasoning level',            fn: cmdReasoning },
  '/permission': { desc: 'Set permission mode',            fn: cmdPermission },
  '/clear':      { desc: 'Clear conversation history',     fn: cmdClear },
  '/config':     { desc: 'View/set config',                fn: cmdConfig },
  '/serve':      { desc: 'Launch the web app',             fn: cmdServe },
  '/history':    { desc: 'Show conversation history',      fn: cmdHistory },
  '/exit':       { desc: 'Exit Mizi CLI',                  fn: cmdExit },
  '/quit':       { desc: 'Exit Mizi CLI',                  fn: cmdExit },
};

async function handleSlash(input) {
  const [cmd, ...args] = input.split(/\s+/);
  const entry = SLASH_COMMANDS[cmd];
  if (!entry) {
    console.log(`\x1b[31mUnknown command: ${cmd}\x1b[0m. Type /help for available commands.`);
    return;
  }
  await entry.fn(args.join(' '));
}

// ── Command Handlers ──

function cmdHelp() {
  console.log('\n\x1b[1m  Available Commands:\x1b[0m\n');
  for (const [cmd, { desc }] of Object.entries(SLASH_COMMANDS)) {
    console.log(`  \x1b[36m${cmd.padEnd(14)}\x1b[0m ${desc}`);
  }
  console.log('\n  \x1b[90mPermission shortcuts (during approval prompts):\x1b[0m');
  console.log('  \x1b[33my\x1b[0m = approve  \x1b[33mn\x1b[0m = deny  \x1b[33me\x1b[0m = accept-edits  \x1b[33mb\x1b[0m = bypass');
  console.log();
}

async function cmdModel(arg) {
  if (arg) {
    config.set('model', arg);
    console.log(`\x1b[32mModel set to: ${arg}\x1b[0m`);
    return;
  }
  const current = config.get('model');
  console.log(`\x1b[90mCurrent model:\x1b[0m ${current || '(none)'}\n`);
  console.log('  Usage: /model <model-id>');
  console.log('  Use /models to see available models from your provider.\n');
}

async function cmdModels() {
  const provId = config.get('provider');
  console.log(`\x1b[90mFetching models from ${provId}...\x1b[0m`);
  const models = await fetchModels(provId);
  if (models.length === 0) {
    console.log('  No models found. Check your provider config with /provider.');
    return;
  }
  console.log(`\n\x1b[1m  Available models (${models.length}):\x1b[0m\n`);
  for (const m of models) {
    const marker = m.id === config.get('model') ? ' \x1b[32m●\x1b[0m' : '';
    console.log(`  ${m.id}${marker}`);
  }
  console.log(`\n  \x1b[90m● = currently selected\x1b[0m`);
  console.log('  Use /model <id> to select.\n');
}

async function cmdProvider(arg) {
  if (arg === 'add') {
    console.log('\n  \x1b[1mAdd Custom Provider\x1b[0m');
    console.log('  Enter provider details (or press Enter to skip):\n');

    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(r => rl2.question(q, r));

    const name = (await ask('  Name: ')).trim();
    if (!name) { rl2.close(); return; }
    const baseUrl = (await ask('  Base URL (OpenAI-compatible /v1): ')).trim();
    const apiKey = (await ask('  API Key: ')).trim();
    const modelsStr = (await ask('  Model IDs (comma-separated): ')).trim();
    rl2.close();

    const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    config.addProvider(id, {
      name, baseUrl, apiKey,
      models: modelsStr.split(',').map(s => s.trim()).filter(Boolean),
    });
    console.log(`\n\x1b[32m✓ Provider "${name}" added as ${id}\x1b[0m\n`);
    return;
  }

  if (arg.startsWith('set ')) {
    const id = arg.slice(4).trim();
    if (!config.getProvider(id)) {
      console.log(`\x1b[31mProvider "${id}" not found.\x1b[0m`);
      return;
    }
    config.set('provider', id);
    console.log(`\x1b[32mSwitched to provider: ${id}\x1b[0m`);
    return;
  }

  // List providers (default)
  const providers = config.listProviders();
  console.log('\n  \x1b[1mProviders:\x1b[0m\n');
  for (const [id, p] of Object.entries(providers)) {
    const marker = id === config.get('provider') ? ' \x1b[32m●\x1b[0m' : '';
    console.log(`  ${id}${marker} — ${p.name} (${p.baseUrl})`);
  }
  console.log('\n  /provider add — add a custom provider');
  console.log('  /provider set <id> — switch active provider\n');
}

async function cmdEffort(arg) {
  if (arg && EFFORTS.includes(arg)) {
    config.set('effort', arg);
    console.log(`\x1b[32mEffort set to: ${arg}\x1b[0m`);
    return;
  }
  console.log('\n  \x1b[1mEffort levels:\x1b[0m\n');
  for (const e of EFFORTS) {
    const marker = e === config.get('effort') ? ' \x1b[32m●\x1b[0m' : '';
    console.log(`  ${e}${marker}`);
  }
  console.log('\n  /effort <level>\n');
}

async function cmdReasoning(arg) {
  if (arg && REASONING_LEVELS.includes(arg)) {
    config.set('reasoning', arg);
    console.log(`\x1b[32mReasoning set to: ${arg}\x1b[0m`);
    return;
  }
  console.log('\n  \x1b[1mReasoning levels:\x1b[0m\n');
  for (const r of REASONING_LEVELS) {
    const marker = r === config.get('reasoning') ? ' \x1b[32m●\x1b[0m' : '';
    console.log(`  ${r}${marker}`);
  }
  console.log('\n  /reasoning <level>\n');
}

async function cmdPermission(arg) {
  if (arg && PERMISSION_MODES.includes(arg)) {
    config.set('permission', arg);
    console.log(`\x1b[32mPermission mode set to: ${arg}\x1b[0m`);
    return;
  }
  console.log('\n  \x1b[1mPermission modes:\x1b[0m\n');
  for (const m of PERMISSION_MODES) {
    const marker = m === getPermissionMode() ? ' \x1b[32m●\x1b[0m' : '';
    console.log(`  ${m}${marker}`);
  }
  console.log('  bypass       — auto-approve everything');
  console.log('  accept-edits — auto-approve file edits, ask for shell');
  console.log('  ask          — ask before every action');
  console.log('  plan         — suggest only, never execute');
  console.log('\n  /permission <mode>\n');
}

function cmdClear() {
  messages = [];
  console.log('\x1b[32mConversation cleared.\x1b[0m\n');
}

function cmdConfig() {
  const d = config.data;
  console.log('\n  \x1b[1mConfiguration:\x1b[0m\n');
  console.log(`  Provider:      ${d.provider}`);
  console.log(`  Model:         ${d.model || '(none)'}`);
  console.log(`  Effort:        ${d.effort}`);
  console.log(`  Reasoning:     ${d.reasoning}`);
  console.log(`  Permission:    ${d.permission}`);
  console.log(`  Config file:   ~/.mizi/config.json`);
  console.log();
}

function cmdServe() {
  console.log('\x1b[90mStarting web server...\x1b[0m');
  const binPath = resolve(__dirname, '..', 'bin', 'mizi-server');
  spawn('node', [binPath], { stdio: 'inherit', detached: true });
}

function cmdHistory() {
  if (messages.length === 0) {
    console.log('\x1b[90mNo conversation history.\x1b[0m');
    return;
  }
  console.log('\n  \x1b[1mConversation:\x1b[0m\n');
  for (const m of messages) {
    const role = m.role === 'user' ? '\x1b[36mYou' : '\x1b[32mMizi';
    const preview = m.content.length > 100 ? m.content.slice(0, 100) + '…' : m.content;
    console.log(`  ${role}:\x1b[0m ${preview.replace(/\n/g, ' ')}`);
  }
  console.log();
}

function cmdExit() {
  console.log('\n  \x1b[90mGoodbye! ✦\x1b[0m\n');
  rl.close();
  process.exit(0);
}
