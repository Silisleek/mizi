import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { config } from './config.js';
import { streamChat, EFFORTS, REASONING_LEVELS, fetchModels } from './ai.js';
import { PERMISSION_MODES, getPermissionMode } from './permissions.js';
import { executeTool } from './tools.js';

const h = React.createElement;

// ── Colors ──

const C = {
  bg:       '#1a1a1a',
  card:     '#242424',
  border:   '#3a3a3a',
  lime:     '#32CD32',
  brown:    '#C4A265',
  lav:      '#B57EDC',
  cyan:     '#56B6C2',
  dim:      '#666',
  text:     '#E0E0E0',
  bright:   '#F5F5F5',
  orange:   '#E5A35E',
  red:      '#E5695E',
};

// ── Context Meter (bottom-right) ──

const MAXCTX = { instant: 4096, fast: 8192, normal: 32768, compact: 2048, power: 65536 };

function ContextMeter({ messages }) {
  const effort = config.get('effort');
  const max = MAXCTX[effort] || 32768;
  const used = messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
  const pct = Math.min(100, Math.round((used / max) * 100));
  const color = pct > 80 ? C.red : pct > 50 ? C.brown : C.lime;

  return h(Text, { color: C.dim },
    h(Text, { color }, formatK(used)), h(Text, null, ` (${pct}%)`),
  );
}

function formatK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

// ── Message Bubble ──

function Message({ role, content }) {
  const isUser = role === 'user';
  return h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Box, { borderStyle: 'single', borderLeftColor: C.cyan, borderTopColor: C.border, borderBottomColor: C.border, borderRightColor: C.border, paddingLeft: 1, paddingRight: 1, paddingBottom: 0 },
      h(Text, { color: isUser ? C.text : C.text, wrap: 'wrap' }, content),
    ),
    !isUser && h(Box, { paddingLeft: 2, marginTop: 0 },
      h(Text, { dimColor: true },
        h(Text, { color: C.brown }, '⊞ '),
        config.get('provider'),
        h(Text, null, ' · '),
        h(Text, { color: C.dim }, 'just now'),
      ),
    ),
  );
}

// ── Composer (input card) ──

function Composer({ input, onChange, onSubmit, busy }) {
  const model = config.get('model');
  const effort = config.get('effort');
  const perm = getPermissionMode();
  const provider = config.get('provider');
  const modelLabel = model ? model.split('/').pop() : 'no model';

  return h(Box, { flexDirection: 'column', borderStyle: 'single', borderLeftColor: busy ? C.orange : C.cyan, borderTopColor: C.border, borderBottomColor: C.border, borderRightColor: C.border, paddingLeft: 1, paddingRight: 1, paddingBottom: 0, marginTop: 1 },
    h(Box, null,
      h(TextInput, {
        value: input, onChange, onSubmit,
        placeholder: busy ? '' : 'Ask anything...',
        focus: !busy,
      }),
    ),
    h(Box, { justifyContent: 'space-between' },
      h(Text, { dimColor: true },
        h(Text, { color: C.brown }, provider),
        h(Text, null, ' · '),
        h(Text, null, modelLabel),
        h(Text, null, ' · '),
        h(Text, { color: C.orange }, effort),
      ),
    ),
  );
}

// ── Command Menu ──

const COMMANDS = [
  { n: '/help',       d: 'Show help' },
  { n: '/model',      d: 'Set model' },
  { n: '/models',     d: 'List models' },
  { n: '/provider',   d: 'Switch provider' },
  { n: '/effort',     d: 'Set effort' },
  { n: '/reasoning',  d: 'Set reasoning' },
  { n: '/permission', d: 'Set permissions' },
  { n: '/clear',      d: 'Clear chat' },
  { n: '/config',     d: 'View config' },
  { n: '/serve',      d: 'Launch web app' },
  { n: '/exit',       d: 'Exit' },
];

function CommandMenu({ query }) {
  const filtered = COMMANDS.filter(c => c.n.startsWith(query.toLowerCase()));
  if (!filtered.length) return null;
  return h(Box, { flexDirection: 'column', borderStyle: 'single', borderLeftColor: C.cyan, borderTopColor: C.border, borderBottomColor: C.border, borderRightColor: C.border, paddingLeft: 1, paddingRight: 1, marginTop: 1 },
    ...filtered.map(c =>
      h(Text, { key: c.n },
        h(Text, { color: C.cyan }, c.n.padEnd(14)),
        h(Text, { color: C.dim }, c.d),
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
        setOutputLines(['',
          '  Commands',
          '  ─'.repeat(18),
          ...COMMANDS.map(c => `  ${c.n.padEnd(14)} ${c.d}`),
          '', '  Permissions: y=approve  n=deny  e=edit-only  b=bypass', '']);
        break;
      case '/model':
        if (arg) { config.set('model', arg); setOutputLines([`  ✓ Model → ${arg}`]); }
        else setOutputLines([`  Model: ${config.get('model') || '(none)'}`, '  /model <id>']);
        break;
      case '/models': {
        setOutputLines(['  Fetching...']);
        const models = await fetchModels(config.get('provider'));
        if (!models.length) { setOutputLines(['  No models found.']); break; }
        const lines = ['', `  Models (${models.length}):`, ''];
        for (const m of models) {
          lines.push(`    ${m.id}${m.id === config.get('model') ? ' ✓' : ''}`);
        }
        lines.push('', '  /model <id> to select', '');
        setOutputLines(lines);
        break;
      }
      case '/provider': {
        if (arg.startsWith('set ')) {
          const id = arg.slice(4).trim();
          if (!config.getProvider(id)) { setOutputLines([`  Provider "${id}" not found.`]); break; }
          config.set('provider', id); setOutputLines([`  ✓ Provider → ${id}`]); break;
        }
        const provs = config.listProviders();
        const lines = ['', '  Providers:', ''];
        for (const [id, p] of Object.entries(provs)) {
          lines.push(`    ${id}${id === config.get('provider') ? ' ✓' : ''}  ${p.name}`);
        }
        lines.push('', '  /provider set <id>', '');
        setOutputLines(lines);
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
        else { const lines = ['', '  Permissions:', '']; for (const m of PERMISSION_MODES) lines.push(`    ${m}${m === getPermissionMode() ? ' ✓' : ''}`); lines.push(''); setOutputLines(lines); }
        break;
      case '/clear':
        setMessages([]); msgsRef.current = []; setOutputLines([]); setStreamBuffer(''); break;
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
    // Logo (big stylized text like OpenCode)
    showHome && h(Box, { justifyContent: 'center', marginTop: 6, marginBottom: 2 },
      h(Text, { color: C.dim, bold: true, fontSize: 1 },
        '███╗   ███╗██╗██╗     ██╗ ██████╗ ███████╗██╗  ██╗',
      ),
    ),
    showHome && h(Box, { justifyContent: 'center' },
      h(Text, { color: C.dim, bold: true },
        '████╗ ████║██║██║     ██║██╔═══██╗██╔════╝╚██╗██╔╝',
      ),
    ),
    showHome && h(Box, { justifyContent: 'center' },
      h(Text, { color: C.dim, bold: true },
        '██╔████╔██║██║██║     ██║██║   ██║███████╗ ╚███╔╝ ',
      ),
    ),
    showHome && h(Box, { justifyContent: 'center' },
      h(Text, { color: C.dim, bold: true },
        '██║╚██╔╝██║██║██║     ██║██║   ██║╚════██║ ██╔██╗ ',
      ),
    ),
    showHome && h(Box, { justifyContent: 'center' },
      h(Text, { color: C.dim, bold: true },
        '██║ ╚═╝ ██║██║███████╗██║╚██████╔╝███████║██╔╝ ██╗',
      ),
    ),
    showHome && h(Box, { justifyContent: 'center', marginBottom: 2 },
      h(Text, { color: C.dim, bold: true },
        '╚═╝     ╚═╝╚═╝╚══════╝╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝',
      ),
    ),

    // Conversation messages
    ...messages.map((m, i) => h(Message, { key: `m${i}`, role: m.role, content: m.content })),

    // Stream buffer (in-progress)
    streamBuffer && h(Box, { borderStyle: 'single', borderLeftColor: C.cyan, borderTopColor: C.border, borderBottomColor: C.border, borderRightColor: C.border, paddingLeft: 1, paddingRight: 1, marginBottom: 1 },
      h(Text, { wrap: 'wrap' }, streamBuffer),
    ),

    // Output lines (commands)
    ...outputLines.map((l, i) => h(Text, { key: `o${i}` }, l)),

    // Command menu
    input.startsWith('/') && h(CommandMenu, { query: input }),

    // Composer
    h(Composer, { input, onChange: setInput, onSubmit: handleSubmit, busy }),

    // Footer
    h(Box, { justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginTop: 0 },
      h(ContextMeter, { messages }),
      h(Text, { dimColor: true },
        h(Text, { color: C.lime }, '?'), ' help',
        h(Text, null, '  '),
        h(Text, { color: C.lime }, '/'), ' commands',
      ),
    ),
  );
}

export function startTUI() { render(h(App)); }
