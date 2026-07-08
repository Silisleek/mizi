import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { config } from './config.js';
import { streamChat, EFFORTS, REASONING_LEVELS, fetchModels } from './ai.js';
import { PERMISSION_MODES, getPermissionMode } from './permissions.js';
import { executeTool } from './tools.js';

const h = React.createElement;

// ── Theme ──

const LIME      = '#32CD32';
const BROWN     = '#C4A265';
const LAVENDER  = '#B57EDC';
const DIM       = '#666';
const BRIGHT    = '#F0F0F0';

// ── Context Meter ──

const MAX_CONTEXT = { instant: 4096, fast: 8192, normal: 32768, compact: 2048, power: 65536 };

function ContextMeter({ messages }) {
  const effort = config.get('effort');
  const max = MAX_CONTEXT[effort] || 32768;

  // Estimate tokens used (~4 chars per token)
  const used = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  const pct = Math.min(100, Math.round((used / max) * 100));

  const barWidth = 24;
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;

  const color = pct > 80 ? '#E5695E' : pct > 50 ? BROWN : LIME;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  return h(Box, null,
    h(Text, { dimColor: true }, '  '),
    h(Text, { color }, bar),
    h(Text, { dimColor: true }, ` ${formatNum(used)}/${formatNum(max)}`),
  );
}

function formatNum(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// ── Logo ──

function Logo() {
  return h(Box, { flexDirection: 'column', marginTop: 1, marginBottom: 1, alignItems: 'center' },
    h(Text, { color: LAVENDER, bold: true }, 'm i z i'),
  );
}

// ── StatusBar ──

function StatusBar() {
  const model = config.get('model');
  const effort = config.get('effort');
  const perm = getPermissionMode();
  const modelLabel = model ? model.split('/').pop() : 'no model';

  return h(Box, { justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 },
    h(Text, null,
      h(Text, { color: LIME }, '●'),
      h(Text, { color: DIM }, ` ${modelLabel}  `),
      h(Text, { color: BROWN }, '·'),
      h(Text, { color: DIM }, ` ${effort}  `),
      h(Text, { color: LAVENDER }, '·'),
      h(Text, { color: DIM }, ` ${perm}`),
    ),
    h(Text, { dimColor: true },
      h(Text, { color: LIME }, '/'), ' help',
      h(Text, { color: DIM }, '  '),
      h(Text, { color: LIME }, '?'), ' cmds',
    ),
  );
}

// ── Command Menu ──

const COMMANDS = [
  { name: '/help',       desc: 'Show help' },
  { name: '/model',      desc: 'Set model' },
  { name: '/models',     desc: 'List models' },
  { name: '/provider',   desc: 'Switch provider' },
  { name: '/effort',     desc: 'Set effort' },
  { name: '/reasoning',  desc: 'Set reasoning' },
  { name: '/permission', desc: 'Set permissions' },
  { name: '/clear',      desc: 'Clear chat' },
  { name: '/config',     desc: 'View config' },
  { name: '/serve',      desc: 'Launch web app' },
  { name: '/exit',       desc: 'Exit' },
];

function CommandMenu({ query }) {
  const filtered = COMMANDS.filter(c => c.name.startsWith(query.toLowerCase()));
  if (!filtered.length) return null;
  return h(Box, { flexDirection: 'column', marginLeft: 1, marginTop: 1 },
    ...filtered.map(cmd =>
      h(Text, { key: cmd.name },
        h(Text, { color: LIME }, '  ' + cmd.name.padEnd(14)),
        h(Text, { color: DIM }, cmd.desc),
      )
    ),
  );
}

// ── System Prompt ──

const SYSTEM_PROMPT = `You are Mizi, a helpful AI coding assistant running in the user's terminal.
You have access to tools for file operations and running commands.

Available tools:
- read_file(path): Read a file's contents
- write_file(path, content): Create or overwrite a file
- edit_file(path, old_text, new_text): Find and replace text in a file
- list_files(path): List files in a directory
- run_command(command): Run a shell command

When you need to use a tool, output your response as a JSON tool call:
<tool_use>{"name": "tool_name", "args": {"param": "value"}}</tool_use>

You can make multiple tool calls. After tool results are returned, continue.
Be concise and helpful. Use markdown formatting in your responses.`;

// ── App ──

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [outputLines, setOutputLines] = useState([]);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const { exit } = useApp();
  const busyRef = useRef(false);
  const messagesRef = useRef([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const handleSlash = useCallback(async (text) => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ');
    switch (cmd) {
      case '/help':
        setOutputLines([
          '',
          '  ' + '—'.repeat(36),
          '  Commands',
          '  ' + '—'.repeat(36),
          '',
          '  ' + hStr('/help') + '       Show this help',
          '  ' + hStr('/model') + '      Set model',
          '  ' + hStr('/models') + '     List available models',
          '  ' + hStr('/provider') + '   Switch provider',
          '  ' + hStr('/effort') + '     Set effort level',
          '  ' + hStr('/reasoning') + '  Set reasoning level',
          '  ' + hStr('/permission') + ' Set permission mode',
          '  ' + hStr('/clear') + '      Clear conversation',
          '  ' + hStr('/config') + '     View configuration',
          '  ' + hStr('/serve') + '      Launch web app',
          '  ' + hStr('/exit') + '       Exit',
          '',
          '  Permissions: y=approve  n=deny  e=edit-only  b=bypass',
          '',
        ]);
        break;
      case '/model':
        if (arg) { config.set('model', arg); setOutputLines([`  ${okStr()} Model → ${arg}`]); }
        else setOutputLines([`  Model: ${config.get('model') || '(none)'}`, '  /model <id>']);
        break;
      case '/models': {
        setOutputLines(['  Fetching...']);
        const models = await fetchModels(config.get('provider'));
        if (!models.length) { setOutputLines(['  No models found.']); break; }
        const lines = ['', `  Models (${models.length}):`, ''];
        for (const m of models) {
          const s = m.id === config.get('model') ? ` ${okStr()}` : '';
          lines.push(`    ${m.id}${s}`);
        }
        lines.push('', '  /model <id> to select', '');
        setOutputLines(lines);
        break;
      }
      case '/provider': {
        if (arg.startsWith('set ')) {
          const id = arg.slice(4).trim();
          if (!config.getProvider(id)) { setOutputLines([`  Provider "${id}" not found.`]); break; }
          config.set('provider', id); setOutputLines([`  ${okStr()} Provider → ${id}`]);
          break;
        }
        const provs = config.listProviders();
        const lines = ['', '  Providers:', ''];
        for (const [id, p] of Object.entries(provs)) {
          const s = id === config.get('provider') ? ` ${okStr()}` : '';
          lines.push(`    ${id}${s}  ${p.name}`);
        }
        lines.push('', '  /provider set <id>', '');
        setOutputLines(lines);
        break;
      }
      case '/effort':
        if (arg && EFFORTS.includes(arg)) { config.set('effort', arg); setOutputLines([`  ${okStr()} Effort → ${arg}`]); }
        else { const lines = ['', '  Effort:', '']; for (const e of EFFORTS) lines.push(`    ${e}${e === config.get('effort') ? ` ${okStr()}` : ''}`); lines.push(''); setOutputLines(lines); }
        break;
      case '/reasoning':
        if (arg && REASONING_LEVELS.includes(arg)) { config.set('reasoning', arg); setOutputLines([`  ${okStr()} Reasoning → ${arg}`]); }
        else { const lines = ['', '  Reasoning:', '']; for (const r of REASONING_LEVELS) lines.push(`    ${r}${r === config.get('reasoning') ? ` ${okStr()}` : ''}`); lines.push(''); setOutputLines(lines); }
        break;
      case '/permission':
        if (arg && PERMISSION_MODES.includes(arg)) { config.set('permission', arg); setOutputLines([`  ${okStr()} Permission → ${arg}`]); }
        else { const lines = ['', '  Permission modes:', '']; for (const m of PERMISSION_MODES) lines.push(`    ${m}${m === getPermissionMode() ? ` ${okStr()}` : ''}`); lines.push(''); setOutputLines(lines); }
        break;
      case '/clear':
        setMessages([]); messagesRef.current = []; setOutputLines([]); setStreamBuffer('');
        break;
      case '/config': {
        const d = config.data;
        setOutputLines(['', '  Configuration', '', `    Provider   → ${d.provider}`, `    Model      → ${d.model || '(none)'}`, `    Effort     → ${d.effort}`, `    Reasoning  → ${d.reasoning}`, `    Permission → ${d.permission}`, `    Config     → ~/.mizi/config.json`, '']);
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
    setShowBanner(false); setInput('');
    if (trimmed.startsWith('/')) { await handleSlash(trimmed); return; }
    if (busyRef.current) return;

    const newMsgs = [...messagesRef.current, { role: 'user', content: trimmed }];
    setMessages(newMsgs); messagesRef.current = newMsgs;
    busyRef.current = true; setBusy(true); setStreamBuffer(''); setOutputLines([]);

    const sys = { role: 'system', content: SYSTEM_PROMPT };
    try {
      let full = '';
      for await (const chunk of streamChat([sys, ...newMsgs.slice(-20)])) { full += chunk; setStreamBuffer(full); }

      const toolMatch = full.match(/<tool_use>(\{.*?\})<\/tool_use>/s);
      if (toolMatch) {
        const tc = JSON.parse(toolMatch[1]);
        const result = await executeTool(tc.name, tc.args);
        const updated = [...newMsgs, { role: 'assistant', content: full },
          { role: 'user', content: `Tool result:\n${JSON.stringify(result, null, 2)}` }];
        setMessages(updated); messagesRef.current = updated; setStreamBuffer('');
        let f2 = '';
        for await (const c of streamChat([sys, ...updated.slice(-20)])) { f2 += c; setStreamBuffer(f2); }
        const fin = [...updated, { role: 'assistant', content: f2 }];
        setMessages(fin); messagesRef.current = fin;
      } else {
        const fin = [...newMsgs, { role: 'assistant', content: full }];
        setMessages(fin); messagesRef.current = fin;
      }
    } catch (e) { setOutputLines([`  Error: ${e.message}`]); }
    setStreamBuffer(''); busyRef.current = false; setBusy(false);
  }, [handleSlash]);

  return h(Box, { flexDirection: 'column' },
    showBanner && h(Logo),
    showBanner && h(ContextMeter, { messages }),

    ...outputLines.map((l, i) => h(Text, { key: `o${i}` }, l)),
    streamBuffer && h(Text, null, streamBuffer),

    showBanner && input.startsWith('/') && h(CommandMenu, { query: input }),

    h(Box, { marginTop: 1 },
      h(Text, { color: busy ? BROWN : LIME, bold: true }, busy ? '  ⏳ ' : '  > '),
      h(TextInput, {
        value: input, onChange: setInput, onSubmit: handleSubmit,
        placeholder: busy ? 'thinking...' : 'ask anything',
        focus: !busy,
      }),
    ),
    h(ContextMeter, { messages }),
    h(StatusBar),
  );
}

function hStr(s) { return s; }
function okStr() { return `\x1b[32m✓\x1b[0m`; }

export function startTUI() { render(h(App)); }
