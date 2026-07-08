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
  fetchProviderModels,
} from './provider-manager.js';
import { ProviderWizard } from './provider-wizard.js';
import { ArrowSelect, Spinner, StreamingDots } from './arrow-select.js';

const h = React.createElement;

// ── Palette ──

const P = {
  border: '#333',
  lime: '#32CD32',
  brown: '#C4A265',
  lav: '#B57EDC',
  cyan: '#56B6C2',
  dim: '#555',
  text: '#DDD',
  orange: '#E5A35E',
  red: '#E5695E',
  green: '#32CD32',
};

const MAXCTX = { instant: 4096, fast: 8192, normal: 32768, compact: 2048, power: 65536 };
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

// ── UI Components ──

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
  return h(Box, { justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 },
    h(Text, { dimColor: true },
      h(Text, { color: P.lime }, '●'), ' ',
      h(Text, null, prov?.name || 'no provider'), ' ',
      h(Text, { color: P.dim }, '·'), ' ',
      h(Text, null, model ? model.split('/').pop() : 'no model'), ' ',
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
  return h(Box, {
    borderStyle: 'single',
    borderLeftColor: isUser ? P.cyan : P.green,
    borderTopColor: P.border, borderBottomColor: P.border, borderRightColor: P.border,
    paddingLeft: 1, paddingRight: 1, marginBottom: 0,
  },
    h(Text, { wrap: 'wrap' }, content),
  );
}

function Composer({ input, onChange, onSubmit, busy }) {
  return h(Box, {
    flexDirection: 'column',
    borderStyle: 'single',
    borderLeftColor: busy ? P.orange : P.cyan,
    borderTopColor: P.border, borderBottomColor: P.border, borderRightColor: P.border,
    paddingLeft: 1, paddingRight: 1, marginTop: 1,
  },
    h(TextInput, {
      value: input, onChange, onSubmit,
      placeholder: busy ? '' : 'Ask anything...',
      focus: !busy,
    }),
  );
}

// ── Arrow-key command palette ──

const COMMANDS = [
  { n: '/help', d: 'Show help' },
  { n: '/model', d: 'Set model' },
  { n: '/models', d: 'List models' },
  { n: '/provider', d: 'Provider manager' },
  { n: '/effort', d: 'Set effort' },
  { n: '/reasoning', d: 'Set reasoning' },
  { n: '/permission', d: 'Set permissions' },
  { n: '/clear', d: 'Clear chat' },
  { n: '/config', d: 'View config' },
  { n: '/serve', d: 'Launch web app' },
  { n: '/exit', d: 'Exit' },
];

function CommandPalette({ query, onSelect }) {
  const filtered = COMMANDS.filter(c => c.n.startsWith(query.toLowerCase()));
  if (!filtered.length) return null;

  return h(ArrowSelect, {
    items: filtered,
    onSelect: (item) => onSelect(item.n),
    formatItem: (item) => `${item.n.padEnd(14)} ${item.d}`,
  });
}

// ── Arrow-key effort picker ──

function EffortPicker({ onSelect, onCancel }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    h(Text, { color: P.lav, bold: true }, '  Effort level'),
    h(Text, { color: P.dim }, '  ↓↑ select · Enter confirm · Esc cancel'),
    h(ArrowSelect, {
      items: EFFORTS,
      onSelect: (item) => onSelect(item),
      onCancel,
      formatItem: (item) => `${item}${item === config.get('effort') ? ' ✓' : ''}`,
    }),
  );
}

// ── Arrow-key reasoning picker ──

function ReasoningPicker({ onSelect, onCancel }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    h(Text, { color: P.lav, bold: true }, '  Reasoning level'),
    h(Text, { color: P.dim }, '  ↓↑ select · Enter confirm · Esc cancel'),
    h(ArrowSelect, {
      items: REASONING_LEVELS,
      onSelect: (item) => onSelect(item),
      onCancel,
      formatItem: (item) => `${item}${item === config.get('reasoning') ? ' ✓' : ''}`,
    }),
  );
}

// ── Arrow-key permission picker ──

function PermissionPicker({ onSelect, onCancel }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    h(Text, { color: P.lav, bold: true }, '  Permission mode'),
    h(Text, { color: P.dim }, '  ↓↑ select · Enter confirm · Esc cancel'),
    h(ArrowSelect, {
      items: PERMISSION_MODES,
      onSelect: (item) => onSelect(item),
      onCancel,
      formatItem: (item) => `${item}${item === getPermissionMode() ? ' ✓' : ''}`,
    }),
  );
}

// ── Arrow-key model picker ──

function ModelPicker({ models, onSelect, onCancel }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    h(Text, { color: P.lav, bold: true }, `  Models (${models.length})`),
    h(Text, { color: P.dim }, '  ↓↑ select · Enter confirm · Esc cancel'),
    h(ArrowSelect, {
      items: models,
      onSelect: (item) => onSelect(item.id),
      onCancel,
      formatItem: (item) => `${item.id}${item.id === config.get('model') ? ' ✓' : ''}`,
    }),
  );
}

// ── Arrow-key provider picker ──

function ProviderPicker({ providers, activeId, onSelect, onCancel }) {
  return h(Box, { flexDirection: 'column', paddingLeft: 1 },
    h(Text, { color: P.lav, bold: true }, '  Switch provider'),
    h(Text, { color: P.dim }, '  ↓↑ select · Enter confirm · Esc cancel'),
    h(ArrowSelect, {
      items: providers,
      onSelect: (item) => onSelect(item.id),
      onCancel,
      formatItem: (item) => `${item.id === activeId ? '● ' : '  '}${item.name}  ${item.baseUrl || '(no url)'}`,
    }),
  );
}

// ── Streaming animation ──

function StreamCard({ content, busy }) {
  if (busy && !content) {
    return h(Box, {
      borderStyle: 'single',
      borderLeftColor: P.orange,
      borderTopColor: P.border, borderBottomColor: P.border, borderRightColor: P.border,
      paddingLeft: 1, paddingRight: 1, marginBottom: 0,
    },
      h(Spinner, { label: 'Thinking' }),
    );
  }
  if (!content) return null;
  return h(Box, {
    borderStyle: 'single',
    borderLeftColor: P.green,
    borderTopColor: P.border, borderBottomColor: P.border, borderRightColor: P.border,
    paddingLeft: 1, paddingRight: 1, marginBottom: 0,
  },
    h(Text, { wrap: 'wrap' }, content),
    busy && h(StreamingDots),
  );
}

// ── System Prompt ──

const SYS = `You are a helpful AI coding assistant. You have access to tools for file operations and running commands. Be concise and helpful. Use markdown formatting.`;

// ── App ──

function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [outputLines, setOutputLines] = useState([]);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  // Overlay modes (arrow-key pickers)
  const [effortPicker, setEffortPicker] = useState(false);
  const [reasoningPicker, setReasoningPicker] = useState(false);
  const [permissionPicker, setPermissionPicker] = useState(false);
  const [modelPicker, setModelPicker] = useState(null); // null or array of models
  const [providerPicker, setProviderPicker] = useState(null); // null or array of providers

  const { exit } = useApp();
  const busyRef = useRef(false);
  const msgsRef = useRef([]);

  useEffect(() => { msgsRef.current = messages; }, [messages]);
  useEffect(() => {
    if (!getActiveProvider() && !showWizard) setShowWizard(true);
  }, []);

  const handleSlash = useCallback(async (text) => {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ');

    switch (cmd) {
      case '/help':
        setOutputLines([
          '', '  Commands', '',
          ...COMMANDS.map(c => `  ${c.n.padEnd(14)} ${c.d}`),
          '',
          '  ↓↑ arrow keys work in all menus',
          '',
        ]);
        break;

      case '/model':
        if (arg) { config.set('model', arg); setOutputLines([`  ✓ Model → ${arg}`]); }
        else setOutputLines([`  Model: ${config.get('model') || '(none)'}`, '  /model <id>']);
        break;

      case '/models': {
        setOutputLines([]); setStreamBuffer('');
        try {
          const prov = getActiveProvider();
          if (!prov) { setOutputLines(['  No active provider. /provider add']); break; }
          const models = await fetchProviderModels(prov);
          if (!models.length) { setOutputLines(['  No models found.']); break; }
          setModelPicker(models);
        } catch (e) { setOutputLines([`  Error: ${e.message}`]); }
        break;
      }

      case '/provider': {
        const provArgs = arg.split(/\s+/);
        const sub = provArgs[0] || '';
        const provId = provArgs[1];

        switch (sub) {
          case 'add': setShowWizard(true); setOutputLines([]); break;
          case 'set': {
            const provs = listProviders();
            if (provs.length <= 1) { setOutputLines(['  Only one provider available. /provider add']); break; }
            setProviderPicker(provs);
            break;
          }
          case 'test': {
            if (!provId) { setOutputLines(['  Usage: /provider test <id>']); break; }
            setOutputLines(['  Testing...']);
            const result = await testProvider(provId);
            setOutputLines(result.ok
              ? [`  ✓ ${result.message}`, `    ${result.latencyMs}ms · ${result.modelsCount} models`]
              : [`  ✗ ${result.message}`]);
            break;
          }
          case 'delete': {
            if (!provId) { setOutputLines(['  Usage: /provider delete <id>']); break; }
            if (removeProvider(provId)) setOutputLines([`  ✓ Removed ${provId}`]);
            else setOutputLines([`  Could not remove ${provId}`]);
            break;
          }
          default: {
            const provs = listProviders();
            const activeId = config.get('provider');
            const lines = ['', '  Providers', ''];
            for (const p of provs) {
              const marker = p.id === activeId ? ' ● ' : '   ';
              lines.push(`  ${marker}${p.name}  ${p.baseUrl || '(no url)'}`);
            }
            lines.push('', '  /provider add      add new', '  /provider set      switch', '  /provider test ID  test', '  /provider delete ID remove', '');
            setOutputLines(lines);
          }
        }
        break;
      }

      case '/effort': setEffortPicker(true); setOutputLines([]); break;
      case '/reasoning': setReasoningPicker(true); setOutputLines([]); break;
      case '/permission': setPermissionPicker(true); setOutputLines([]); break;

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

    try {
      let full = '';
      for await (const chunk of streamChat([{ role: 'system', content: SYS }, ...newMsgs.slice(-20)])) {
        full += chunk; setStreamBuffer(full);
      }

      const toolMatch = full.match(/<tool_use>(\{.*?\})<\/tool_use>/s);
      if (toolMatch) {
        const tc = JSON.parse(toolMatch[1]);
        const result = await executeTool(tc.name, tc.args);
        const updated = [...newMsgs, { role: 'assistant', content: full },
          { role: 'user', content: `Tool result:\n${JSON.stringify(result, null, 2)}` }];
        setMessages(updated); msgsRef.current = updated; setStreamBuffer('');
        let f2 = '';
        for await (const c of streamChat([{ role: 'system', content: SYS }, ...updated.slice(-20)])) { f2 += c; setStreamBuffer(f2); }
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

  if (showWizard) {
    return h(Box, { flexDirection: 'column' },
      h(ProviderWizard, { onComplete: () => { setShowWizard(false); setShowHome(true); }, onCancel: () => setShowWizard(false) }),
    );
  }

  if (effortPicker) {
    return h(EffortPicker, {
      onSelect: (v) => { config.set('effort', v); setEffortPicker(false); setOutputLines([`  ✓ Effort → ${v}`]); },
      onCancel: () => setEffortPicker(false),
    });
  }

  if (reasoningPicker) {
    return h(ReasoningPicker, {
      onSelect: (v) => { config.set('reasoning', v); setReasoningPicker(false); setOutputLines([`  ✓ Reasoning → ${v}`]); },
      onCancel: () => setReasoningPicker(false),
    });
  }

  if (permissionPicker) {
    return h(PermissionPicker, {
      onSelect: (v) => { config.set('permission', v); setPermissionPicker(false); setOutputLines([`  ✓ Permission → ${v}`]); },
      onCancel: () => setPermissionPicker(false),
    });
  }

  if (modelPicker) {
    return h(ModelPicker, {
      models: modelPicker,
      onSelect: (id) => { config.set('model', id); setModelPicker(null); setOutputLines([`  ✓ Model → ${id}`]); },
      onCancel: () => setModelPicker(null),
    });
  }

  if (providerPicker) {
    return h(ProviderPicker, {
      providers: providerPicker,
      activeId: config.get('provider'),
      onSelect: (id) => { setActiveProvider(id); setProviderPicker(null); setOutputLines([`  ✓ Provider → ${id}`]); },
      onCancel: () => setProviderPicker(null),
    });
  }

  return h(Box, { flexDirection: 'column' },
    showHome && h(Title),
    ...messages.map((m, i) => h(MessageCard, { key: `m${i}`, role: m.role, content: m.content })),
    h(StreamCard, { content: streamBuffer, busy }),
    ...outputLines.map((l, i) => h(Text, { key: `o${i}` }, l)),
    input.startsWith('/') && !busy && h(CommandPalette, { query: input, onSelect: (cmd) => { setInput(''); handleSlash(cmd); } }),
    h(Composer, { input, onChange: setInput, onSubmit: handleSubmit, busy }),
    h(StatusBar, { messages }),
  );
}

export function startTUI() {
  ensureActiveProvider();
  render(h(App));
}
