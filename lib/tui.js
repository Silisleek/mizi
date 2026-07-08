import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { config } from './config.js';
import { streamChat, EFFORTS, REASONING_LEVELS, fetchModels } from './ai.js';
import { PERMISSION_MODES, getPermissionMode } from './permissions.js';
import { executeTool } from './tools.js';

const h = React.createElement;

// ── Constants ──

const HELP_LINES = [
  '',
  '  \x1b[1m  Commands\x1b[0m',
  '',
  '  \x1b[36m/help         \x1b[0m Show this help',
  '  \x1b[36m/model        \x1b[0m Set the AI model',
  '  \x1b[36m/models       \x1b[0m List available models',
  '  \x1b[36m/provider     \x1b[0m Switch or add providers',
  '  \x1b[36m/effort       \x1b[0m Set effort level',
  '  \x1b[36m/reasoning    \x1b[0m Set reasoning level',
  '  \x1b[36m/permission   \x1b[0m Set permission mode',
  '  \x1b[36m/clear        \x1b[0m Clear conversation',
  '  \x1b[36m/config       \x1b[0m View configuration',
  '  \x1b[36m/serve        \x1b[0m Launch the web app',
  '  \x1b[36m/exit         \x1b[0m Exit',
  '',
  '  \x1b[90mPermission shortcuts: y=approve n=deny e=accept-edits b=bypass\x1b[0m',
  '',
];

const SLASH_COMMANDS = [
  { name: '/help',       desc: 'Show help' },
  { name: '/model',      desc: 'Set the AI model' },
  { name: '/models',     desc: 'List available models' },
  { name: '/provider',   desc: 'Switch or add providers' },
  { name: '/effort',     desc: 'Set effort level' },
  { name: '/reasoning',  desc: 'Set reasoning level' },
  { name: '/permission', desc: 'Set permission mode' },
  { name: '/clear',      desc: 'Clear conversation' },
  { name: '/config',     desc: 'View configuration' },
  { name: '/serve',      desc: 'Launch the web app' },
  { name: '/exit',       desc: 'Exit' },
];

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

// ── Logo Component ──

function Logo() {
  return h(Box, { flexDirection: 'column', marginTop: 1, alignItems: 'center' },
    h(Text, { color: 'cyan', bold: true }, '╔═══════════════════════════════╗'),
    h(Text, null,
      h(Text, { color: 'cyan', bold: true }, '║  '),
      h(Text, { color: 'white', bold: true }, '✦  M I Z I  ✦'),
      h(Text, { color: 'cyan', bold: true }, '          ║'),
    ),
    h(Text, { color: 'cyan', bold: true }, '╚═══════════════════════════════╝'),
  );
}

// ── StatusBar Component ──

function StatusBar() {
  const model = config.get('model');
  const effort = config.get('effort');
  const perm = getPermissionMode();
  const modelLabel = model ? model.split('/').pop() : 'no model';
  const modelColor = model ? 'green' : 'red';

  return h(Box, { justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 },
    h(Text, { dimColor: true },
      h(Text, { color: modelColor }, '●'),
      ' ', modelLabel, ' · ', effort, ' · ', perm,
    ),
    h(Text, { dimColor: true },
      h(Text, { color: 'yellow' }, '?'), ' help ',
      h(Text, { color: 'yellow' }, '/'), ' commands',
    ),
  );
}

// ── Command Menu Component ──

function CommandMenu({ query }) {
  const filtered = SLASH_COMMANDS.filter(c => c.name.startsWith(query.toLowerCase()));
  if (filtered.length === 0) return null;

  return h(Box, { flexDirection: 'column', marginTop: 1, borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    ...filtered.map(cmd =>
      h(Text, { key: cmd.name },
        '  ',
        h(Text, { color: 'cyan', bold: true }, cmd.name.padEnd(14)),
        h(Text, { color: 'gray' }, cmd.desc),
      )
    ),
  );
}

// ── Main App ──

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
        setOutputLines(HELP_LINES);
        break;

      case '/model':
        if (arg) {
          config.set('model', arg);
          setOutputLines([`  \x1b[32m✓\x1b[0m Model set to \x1b[1m${arg}\x1b[0m`]);
        } else {
          setOutputLines([
            `  Current model: \x1b[1m${config.get('model') || '(none)'}\x1b[0m`,
            '  Usage: /model <model-id>',
          ]);
        }
        break;

      case '/models': {
        setOutputLines(['  Fetching models...']);
        const models = await fetchModels(config.get('provider'));
        if (!models.length) { setOutputLines(['  \x1b[31mNo models found.\x1b[0m']); break; }
        const lines = ['', `  \x1b[1mModels (${models.length}):\x1b[0m`, ''];
        for (const m of models) {
          const s = m.id === config.get('model') ? ' \x1b[32m●\x1b[0m' : '';
          lines.push(`  ${m.id}${s}`);
        }
        lines.push('', '  /model <id> to select', '');
        setOutputLines(lines);
        break;
      }

      case '/provider': {
        if (arg.startsWith('set ')) {
          const id = arg.slice(4).trim();
          if (!config.getProvider(id)) { setOutputLines([`  \x1b[31mProvider "${id}" not found.\x1b[0m`]); break; }
          config.set('provider', id);
          setOutputLines([`  \x1b[32m✓\x1b[0m Switched to \x1b[1m${id}\x1b[0m`]);
          break;
        }
        const providers = config.listProviders();
        const lines = ['', '  \x1b[1mProviders:\x1b[0m', ''];
        for (const [id, p] of Object.entries(providers)) {
          const s = id === config.get('provider') ? ' \x1b[32m●\x1b[0m' : '';
          lines.push(`  ${id}${s}  \x1b[90m${p.name}\x1b[0m`);
        }
        lines.push('', '  /provider set <id>', '');
        setOutputLines(lines);
        break;
      }

      case '/effort':
        if (arg && EFFORTS.includes(arg)) {
          config.set('effort', arg);
          setOutputLines([`  \x1b[32m✓\x1b[0m Effort set to \x1b[1m${arg}\x1b[0m`]);
        } else {
          const lines = ['', '  \x1b[1mEffort:\x1b[0m', ''];
          for (const e of EFFORTS) {
            lines.push(`  ${e}${e === config.get('effort') ? ' \x1b[32m●\x1b[0m' : ''}`);
          }
          lines.push('', '  /effort <level>', '');
          setOutputLines(lines);
        }
        break;

      case '/reasoning':
        if (arg && REASONING_LEVELS.includes(arg)) {
          config.set('reasoning', arg);
          setOutputLines([`  \x1b[32m✓\x1b[0m Reasoning set to \x1b[1m${arg}\x1b[0m`]);
        } else {
          const lines = ['', '  \x1b[1mReasoning:\x1b[0m', ''];
          for (const r of REASONING_LEVELS) {
            lines.push(`  ${r}${r === config.get('reasoning') ? ' \x1b[32m●\x1b[0m' : ''}`);
          }
          lines.push('', '  /reasoning <level>', '');
          setOutputLines(lines);
        }
        break;

      case '/permission':
        if (arg && PERMISSION_MODES.includes(arg)) {
          config.set('permission', arg);
          setOutputLines([`  \x1b[32m✓\x1b[0m Permission set to \x1b[1m${arg}\x1b[0m`]);
        } else {
          const lines = ['', '  \x1b[1mPermission modes:\x1b[0m', ''];
          for (const m of PERMISSION_MODES) {
            lines.push(`  ${m}${m === getPermissionMode() ? ' \x1b[32m●\x1b[0m' : ''}`);
          }
          lines.push('', '  /permission <mode>', '');
          setOutputLines(lines);
        }
        break;

      case '/clear':
        setMessages([]); messagesRef.current = []; setOutputLines([]); setStreamBuffer('');
        break;

      case '/config': {
        const d = config.data;
        setOutputLines([
          '', '  \x1b[1mConfiguration\x1b[0m', '',
          `  Provider     \x1b[90m→\x1b[0m ${d.provider}`,
          `  Model        \x1b[90m→\x1b[0m ${d.model || '\x1b[90m(none)\x1b[0m'}`,
          `  Effort       \x1b[90m→\x1b[0m ${d.effort}`,
          `  Reasoning    \x1b[90m→\x1b[0m ${d.reasoning}`,
          `  Permission   \x1b[90m→\x1b[0m ${d.permission}`,
          `  Config       \x1b[90m→ ~/.mizi/config.json\x1b[0m`, '',
        ]);
        break;
      }

      case '/serve': {
        const { spawn } = await import('node:child_process');
        const { fileURLToPath } = await import('node:url');
        const { resolve, dirname } = await import('node:path');
        const binPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'mizi-server');
        spawn('node', [binPath], { stdio: 'inherit', detached: true });
        setOutputLines(['  \x1b[90mWeb server started\x1b[0m']);
        break;
      }

      case '/exit': case '/quit': exit(); break;
      default: setOutputLines([`  \x1b[31mUnknown command:\x1b[0m ${cmd}`]);
    }
  }, [exit]);

  const handleSubmit = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setShowBanner(false);
    setInput('');
    if (trimmed.startsWith('/')) { await handleSlash(trimmed); return; }
    if (busyRef.current) return;

    const newMsgs = [...messagesRef.current, { role: 'user', content: trimmed }];
    setMessages(newMsgs); messagesRef.current = newMsgs;
    busyRef.current = true; setBusy(true); setStreamBuffer(''); setOutputLines([]);

    const sys = { role: 'system', content: SYSTEM_PROMPT };
    const chat = [sys, ...newMsgs.slice(-20)];

    try {
      let full = '';
      for await (const chunk of streamChat(chat)) { full += chunk; setStreamBuffer(full); }

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
    } catch (e) {
      setOutputLines([`  \x1b[31mError:\x1b[0m ${e.message}`]);
    }

    setStreamBuffer(''); busyRef.current = false; setBusy(false);
  }, [handleSlash]);

  const modelLabel = config.get('model')?.split('/').pop() || 'no model';
  const effort = config.get('effort');
  const perm = getPermissionMode();

  return h(Box, { flexDirection: 'column' },
    // Logo
    showBanner && h(Logo),

    // Output
    ...outputLines.map((line, i) => h(Text, { key: `o${i}` }, line)),

    // Stream
    streamBuffer && h(Text, null, streamBuffer),

    // Command menu
    showBanner && input.startsWith('/') && h(CommandMenu, { query: input }),

    // Input
    h(Box, { marginTop: 1 },
      h(Text, { color: 'cyan', bold: true }, busy ? '  ⏳ ' : '  > '),
      h(TextInput, {
        value: input,
        onChange: setInput,
        onSubmit: handleSubmit,
        placeholder: busy ? 'Thinking...' : `Ask anything...  ${modelLabel} · ${effort} · ${perm}`,
        focus: !busy,
      }),
    ),

    // Status bar
    h(StatusBar),
  );
}

export function startTUI() {
  render(h(App));
}
