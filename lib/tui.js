import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { config } from './config.js';
import { streamChat, EFFORTS, REASONING_LEVELS, fetchModels } from './ai.js';
import { PERMISSION_MODES, getPermissionMode } from './permissions.js';
import { executeTool } from './tools.js';
import {
  listProviders, getProvider, getActiveProvider, setActiveProvider,
  addProvider, removeProvider, testProvider, ensureActiveProvider,
  providerSummary, fetchProviderModels,
} from './provider-manager.js';

const h = React.createElement;

// ── Palette ──

const P = {
  bg:      '#1a1a1a',
  card:    '#1e1e1e',
  border:  '#333',
  lime:    '#32CD32',
  brown:   '#C4A265',
  lav:     '#B57EDC',
  cyan:    '#56B6C2',
  dim:     '#555',
  text:    '#DDD',
  bright:  '#FFF',
  orange:  '#E5A35E',
  red:     '#E5695E',
  green:   '#32CD32',
  yellow:  '#D4A537',
};

const MAXCTX = { instant: 4096, fast: 8192, normal: 32768, compact: 2048, power: 65536 };

// ── Helpers ──

function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

function maskKey(k = '') {
  if (!k) return '(none)';
  if (k.length <= 8) return '••••••••';
  return k.slice(0, 3) + '…' + k.slice(-4);
}

// ── Components ──

function Title() {
  return h(Box, { justifyContent: 'center', marginBottom: 1 },
    h(Text, { color: P.lav, bold: true }, '✦ mizi ✦'),
  );
}

function ContextBar({ messages }) {
  const effort = config.get('effort');
  const max = MAXCTX[effort] || 32768;
  const used = messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
  const pct = Math.min(100, Math.round((used / max) * 100));
  const col = pct > 80 ? P.red : pct > 50 ? P.brown : P.lime;
  return h(Text, { dimColor: true }, h(Text, { color: col }, fmt(used)), `/${fmt(max)} (${pct}%)`);
}

function StatusBar({ messages }) {
  const prov = getActiveProvider();
  const model = config.get('model');
  const effort = config.get('effort');
  const perm = getPermissionMode();
  const provLabel = prov ? prov.name : 'no provider';
  const modelLabel = model ? model.split('/').pop() : 'no model';

  return h(Box, { justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 },
    h(Text, { dimColor: true },
      h(Text, { color: P.lime }, '●'), ' ',
      h(Text, null, provLabel), ' ',
      h(Text, { color: P.dim }, '·'), ' ',
      h(Text, null, modelLabel), ' ',
      h(Text, { color: P.dim }, '·'), ' ',
      h(Text, { color: P.orange }, effort), ' ',
      h(Text, { color: P.dim }, '·'), ' ',
      h(Text, null, perm),
    ),
    h(ContextBar, { messages }),
  );
}

function MessageCard({ role, content }) {
  const isUser = role === 'user';
  return h(Box, { flexDirection: 'column', marginBottom: 0 },
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: isUser ? P.cyan : P.green,
      borderTopColor: P.border,
      borderBottomColor: P.border,
      borderRightColor: P.border,
      paddingLeft: 1, paddingRight: 1,
    },
      h(Text, { wrap: 'wrap' }, content),
    ),
  );
}

const COMMANDS = [
  { n: '/help',       d: 'Show help' },
  { n: '/model',      d: 'Set model' },
  { n: '/models',     d: 'List models' },
  { n: '/provider',   d: 'Provider manager' },
  { n: '/effort',     d: 'Set effort' },
  { n: '/reasoning',  d: 'Set reasoning' },
  { n: '/permission', d: 'Set permissions' },
  { n: '/clear',      d: 'Clear chat' },
  { n: '/config',     d: 'View config' },
  { n: '/serve',      d: 'Launch web app' },
  { n: '/exit',       d: 'Exit' },
];

function CommandPalette({ query }) {
  const filtered = COMMANDS.filter(c => c.n.startsWith(query.toLowerCase()));
  if (!filtered.length) return null;
  return h(Box, { flexDirection: 'column', borderStyle: 'single', borderLeftColor: P.cyan, borderTopColor: P.border, borderBottomColor: P.border, borderRightColor: P.border, paddingLeft: 1, paddingRight: 1 },
    ...filtered.map(c =>
      h(Text, { key: c.n },
        h(Text, { color: P.cyan }, c.n.padEnd(14)),
        h(Text, { color: P.dim }, c.d),
      )
    ),
  );
}

// ── System Prompt ──

const SYS = `You are Mizi, a helpful AI coding assistant running in the user's terminal.
You have access to tools for file operations and running commands.

Available tools:
- read_file(path): Read a file's contents
- write_file(path, content): Create or overwrite a file
- edit_file(path, old_text, new_text): Find and replace text in a file
- list_files(path): List files in a directory
- run_command(command): Run a shell command

When you need to use a tool, output your response as a JSON tool call:
<tool_use>{"name": "tool_name", "args": {"param": "value"}}</tool_use>

Be concise and helpful. Use markdown formatting in your responses.`;

// ── App ──

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [outputLines, setOutputLines] = useState([]);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const { exit } = useApp();
  const busyRef = useRef(false);
  const msgsRef = useRef([]);

  useEffect(() => { msgsRef.current = messages; }, [messages]);

  const handleSlash = useCallback(async (text) => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ');

    switch (cmd) {
      case '/help':
        setOutputLines([
          '', '  Commands', '',
          ...COMMANDS.map(c => `  ${c.n.padEnd(14)} ${c.d}`),
          '',
          '  Provider commands:',
          '  /provider          Provider manager',
          '  /provider add      Add provider',
          '  /provider set ID   Switch provider',
          '  /provider test ID  Test connection',
          '  /provider delete   Remove provider',
          '',
          '  Permissions: y=approve  n=deny  e=edit-only  b=bypass',
          '',
        ]);
        break;

      case '/model':
        if (arg) { config.set('model', arg); setOutputLines([`  ✓ Model → ${arg}`]); }
        else setOutputLines([`  Model: ${config.get('model') || '(none)'}`, '  /model <id>']);
        break;

      case '/models': {
        setOutputLines(['  Fetching models...']);
        try {
          const prov = getActiveProvider();
          if (!prov) { setOutputLines(['  No active provider. Use /provider add']); break; }
          const models = await fetchProviderModels(prov);
          if (!models.length) { setOutputLines(['  No models found.']); break; }
          const lines = ['', `  Models (${models.length}):`, ''];
          for (const m of models) {
            lines.push(`    ${m.id}${m.id === config.get('model') ? ' ✓' : ''}`);
          }
          lines.push('', '  /model <id> to select', '');
          setOutputLines(lines);
        } catch (e) { setOutputLines([`  Error: ${e.message}`]); }
        break;
      }

      case '/provider': {
        const provArgs = arg.split(/\s+/);
        const sub = provArgs[0] || 'list';
        const provId = provArgs[1];

        switch (sub) {
          case 'list': {
            const provs = listProviders();
            const activeId = config.get('provider');
            const lines = ['', '  Providers', ''];
            for (const p of provs) {
              const marker = p.id === activeId ? h(Text, { color: P.green }, ' ● ') : h(Text, { color: P.dim }, '   ');
              lines.push(h(Text, { key: p.id }, marker, h(Text, { bold: p.id === activeId }, p.id), '  ', h(Text, { color: P.dim }, p.name), '  ', h(Text, { color: P.dim }, p.baseUrl || '(no url)')));
            }
            lines.push('', '  /provider add      add new', '  /provider set ID   switch', '  /provider test ID  test', '  /provider delete ID remove', '');
            setOutputLines(lines);
            break;
          }

          case 'add': {
            setOutputLines([
              '',
              '  Interactive provider setup is only available via:',
              '  mizi provider add',
              '',
              '  Or add manually to ~/.mizi/config.json:',
              '  {',
              '    "providers": {',
              '      "my-provider": {',
              '        "name": "My Provider",',
              '        "type": "openai-compatible",',
              '        "baseUrl": "https://api.example.com/v1",',
              '        "apiKey": "sk-...",',
              '        "models": ["model-1", "model-2"]',
              '      }',
              '    }',
              '  }',
              '',
            ]);
            break;
          }

          case 'set': {
            if (!provId) { setOutputLines(['  Usage: /provider set <id>']); break; }
            try {
              const p = setActiveProvider(provId);
              setOutputLines([`  ✓ Active provider → ${p.name} (${p.id})`]);
            } catch (e) { setOutputLines([`  ${e.message}`]); }
            break;
          }

          case 'test': {
            if (!provId) { setOutputLines(['  Usage: /provider test <id>']); break; }
            setOutputLines(['  Testing...']);
            const result = await testProvider(provId);
            if (result.ok) {
              setOutputLines([
                `  ✓ ${result.message}`,
                `    ${result.latencyMs}ms · ${result.modelsCount} models`,
              ]);
            } else {
              setOutputLines([`  ✗ ${result.message}`]);
            }
            break;
          }

          case 'delete': {
            if (!provId) { setOutputLines(['  Usage: /provider delete <id>']); break; }
            if (removeProvider(provId)) setOutputLines([`  ✓ Removed ${provId}`]);
            else setOutputLines([`  Could not remove ${provId}`]);
            break;
          }

          default:
            setOutputLines(['  Usage: /provider [list|add|set|test|delete] [id]']);
        }
        break;
      }

      case '/effort':
        if (arg && EFFORTS.includes(arg)) { config.set('effort', arg); setOutputLines([`  ✓ Effort → ${arg}`]); }
        else { const lines = ['', '  Effort:', '']; for (const e of EFFORTS) lines.push(`    ${e}${e === config.get('effort') ? ' ✓' : ''}`); lines.push(''); setOutputLines(lines); }
        break;

      case '/reasoning':
        if (arg && REASONING_LEVELS.includes(arg)) { config.set('reasoning', arg); setOutputLines([`  ✓ Reasoning → ${arg}`]); }
        else { const lines = ['', '  Reasoning:', '']; for (const r of REASONING_LEVELS) lines.push(`    ${r}${r === config.get('reasoning') ? ' ✓' : ''}`); lines.push(''); setOutputLines(lines); }
        break;

      case '/permission':
        if (arg && PERMISSION_MODES.includes(arg)) { config.set('permission', arg); setOutputLines([`  ✓ Permission → ${arg}`]); }
        else { const lines = ['', '  Permission modes:', '']; for (const m of PERMISSION_MODES) lines.push(`    ${m}${m === getPermissionMode() ? ' ✓' : ''}`); lines.push(''); setOutputLines(lines); }
        break;

      case '/clear':
        setMessages([]); msgsRef.current = []; setOutputLines([]); setStreamBuffer('');
        break;

      case '/config': {
        const d = config.data;
        const prov = getActiveProvider();
        setOutputLines([
          '', '  Configuration', '',
          `  Provider     ${prov ? prov.name + ' (' + prov.id + ')' : '(none)'}`,
          `  Model        ${d.model || '(none)'}`,
          `  Effort       ${d.effort}`,
          `  Reasoning    ${d.reasoning}`,
          `  Permission   ${d.permission}`,
          `  Config       ~/.mizi/config.json`,
          '',
        ]);
        break;
      }

      case '/serve': {
        const { spawn } = await import('node:child_process');
        const { fileURLToPath } = await import('node:url');
        const { resolve, dirname } = await import('node:path');
        spawn('node', [resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mizi-server')], { stdio: 'inherit', detached: true });
        setOutputLines(['  Web server started']);
        break;
      }

      case '/exit': case '/quit': exit(); break;
      default: setOutputLines([`  Unknown command: ${cmd}`]);
    }
  }, [exit]);

  const handleSubmit = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setShowHome(false); setInput('');
    if (trimmed.startsWith('/')) { await handleSlash(trimmed); return; }
    if (busyRef.current) return;

    const newMsgs = [...msgsRef.current, { role: 'user', content: trimmed }];
    setMessages(newMsgs); msgsRef.current = newMsgs;
    busyRef.current = true; setBusy(true); setStreamBuffer(''); setOutputLines([]);

    const sys = { role: 'system', content: SYS };
    try {
      let full = '';
      for await (const chunk of streamChat([sys, ...newMsgs.slice(-20)])) { full += chunk; setStreamBuffer(full); }

      const toolMatch = full.match(/<tool_use>(\{.*?\})<\/tool_use>/s);
      if (toolMatch) {
        const tc = JSON.parse(toolMatch[1]);
        const result = await executeTool(tc.name, tc.args);
        const updated = [...newMsgs, { role: 'assistant', content: full },
          { role: 'user', content: `Tool result:\n${JSON.stringify(result, null, 2)}` }];
        setMessages(updated); msgsRef.current = updated; setStreamBuffer('');
        let f2 = '';
        for await (const c of streamChat([sys, ...updated.slice(-20)])) { f2 += c; setStreamBuffer(f2); }
        const fin = [...updated, { role: 'assistant', content: f2 }];
        setMessages(fin); msgsRef.current = fin;
      } else {
        const fin = [...newMsgs, { role: 'assistant', content: full }];
        setMessages(fin); msgsRef.current = fin;
      }
    } catch (e) { setOutputLines([`  Error: ${e.message}`]); }
    setStreamBuffer(''); busyRef.current = false; setBusy(false);
  }, [handleSlash]);

  // ── Render ──

  return h(Box, { flexDirection: 'column' },
    // Title
    showHome && h(Title),

    // Messages
    ...messages.map((m, i) => h(MessageCard, { key: `m${i}`, role: m.role, content: m.content })),

    // Streaming
    streamBuffer && h(MessageCard, { role: 'assistant', content: streamBuffer }),

    // Output lines
    ...outputLines.map((l, i) => h(Text, { key: `o${i}` }, l)),

    // Command palette
    input.startsWith('/') && h(CommandPalette, { query: input }),

    // Composer
    h(Box, {
      flexDirection: 'column',
      borderStyle: 'single',
      borderLeftColor: busy ? P.orange : P.cyan,
      borderTopColor: P.border,
      borderBottomColor: P.border,
      borderRightColor: P.border,
      paddingLeft: 1, paddingRight: 1,
      marginTop: 1,
    },
      h(TextInput, {
        value: input, onChange: setInput, onSubmit: handleSubmit,
        placeholder: busy ? '' : 'Ask anything...',
        focus: !busy,
      }),
    ),

    // Status
    h(StatusBar, { messages }),
  );
}

export function startTUI() {
  ensureActiveProvider();
  render(h(App));
}
