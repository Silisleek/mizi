import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import {
  addProvider, upsertProvider, getProvider, listProviders,
  testProvider, setActiveProvider, fetchProviderModels,
  buildProviderHeaders,
} from './provider-manager.js';
import { config } from './config.js';

const h = React.createElement;

const C = {
  border: '#333',
  cyan:   '#56B6C2',
  green:  '#32CD32',
  brown:  '#C4A265',
  orange: '#E5A35E',
  red:    '#E5695E',
  dim:    '#555',
  text:   '#DDD',
  lav:    '#B57EDC',
};

// ── Preset providers ──

const PRESETS = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    hint: 'Free models — no API key required',
    needsKey: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'Access GPT-4, Claude, Gemini, and 100+ models',
    needsKey: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'Claude Sonnet, Opus, Haiku',
    needsKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'GPT-4o, GPT-4.1, o3, o4-mini',
    needsKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    hint: 'Ultra-fast inference, free tier available',
    needsKey: true,
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    hint: 'Open-source models, pay-per-token',
    needsKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    hint: 'Local models — no API key needed',
    needsKey: false,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    hint: 'Local models — no API key needed',
    needsKey: false,
  },
  {
    id: 'custom',
    name: 'Custom provider',
    baseUrl: '',
    hint: 'Any OpenAI-compatible /v1 endpoint',
    needsKey: true,
  },
];

// ── Step: Choose provider preset ──

function StepPreset({ onSelect }) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setCursor(c => Math.min(PRESETS.length - 1, c + 1));
    else if (key.return) onSelect(PRESETS[cursor]);
  });

  return h(Box, { flexDirection: 'column' },
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: C.cyan,
      borderTopColor: C.border,
      borderBottomColor: C.border,
      borderRightColor: C.border,
      paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0,
      flexDirection: 'column',
    },
      h(Text, { color: C.lav, bold: true }, '  Choose a provider'),
      h(Text, { color: C.dim }, '  ↓↑ to select · Enter to confirm'),
      h(Text, null, ''),
      ...PRESETS.map((p, i) => {
        const active = i === cursor;
        const marker = active ? h(Text, { color: C.green }, '▸ ') : h(Text, null, '  ');
        return h(Text, { key: p.id },
          marker,
          h(Text, { color: active ? C.text : C.dim, bold: active }, p.name),
          h(Text, { color: C.dim }, '  ' + p.hint),
        );
      }),
    ),
  );
}

// ── Step: Enter details ──

function StepDetails({ preset, onSubmit }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(preset.name);
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [modelsRaw, setModelsRaw] = useState('');

  const fields = [];
  if (preset.id === 'custom' || !preset.baseUrl) {
    fields.push({ label: 'Provider name', value: name, set: setName, placeholder: 'My Provider' });
    fields.push({ label: 'Base URL (OpenAI-compatible /v1)', value: baseUrl, set: setBaseUrl, placeholder: 'https://api.example.com/v1' });
  } else {
    fields.push({ label: 'Provider name', value: name, set: setName, placeholder: preset.name });
  }
  if (preset.needsKey) {
    fields.push({ label: 'API key', value: apiKey, set: setApiKey, placeholder: 'sk-...', secret: true });
  }
  fields.push({ label: 'Model IDs (comma-separated, or leave blank to auto-detect)', value: modelsRaw, set: setModelsRaw, placeholder: 'gpt-4o, claude-sonnet-4' });

  const field = fields[step];

  useInput((input, key) => {
    if (key.escape) {
      if (step > 0) setStep(s => s - 1);
    }
  });

  const handleSubmit = (val) => {
    field.set(val);
    if (step < fields.length - 1) {
      setStep(s => s + 1);
    } else {
      onSubmit({
        name,
        type: preset.id === 'anthropic' ? 'anthropic' : 'openai-compatible',
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        models: modelsRaw.split(',').map(s => s.trim()).filter(Boolean),
        enabled: true,
      });
    }
  };

  const progress = `[${step + 1}/${fields.length}]`;

  return h(Box, { flexDirection: 'column' },
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: C.cyan,
      borderTopColor: C.border,
      borderBottomColor: C.border,
      borderRightColor: C.border,
      paddingLeft: 1, paddingRight: 1, paddingBottom: 0,
      flexDirection: 'column',
    },
      h(Text, { color: C.lav, bold: true }, `  ${preset.name} setup ${progress}`),
      h(Text, { color: C.dim }, '  Esc to go back'),
      h(Text, null, ''),
      h(Text, { color: C.cyan }, `  ${field.label}`),
      h(TextInput, {
        value: field.value,
        onChange: field.set,
        onSubmit: handleSubmit,
        placeholder: field.placeholder || '',
        focus: true,
        mask: field.secret ? '*' : undefined,
      }),
    ),
  );
}

// ── Step: Testing ──

async function testNewProvider(record) {
  const models = await fetchProviderModels(record);
  return { ok: true, models };
}

// ── Step: Choose model ──

function StepModel({ models, onSelect }) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');

  const filtered = models.filter(m => m.id.toLowerCase().includes(filter.toLowerCase()));
  const maxShow = Math.min(15, filtered.length);

  useInput((input, key) => {
    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setCursor(c => Math.min(maxShow - 1, c + 1));
    else if (key.return && filtered[cursor]) onSelect(filtered[cursor].id);
  });

  return h(Box, { flexDirection: 'column' },
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: C.green,
      borderTopColor: C.border,
      borderBottomColor: C.border,
      borderRightColor: C.border,
      paddingLeft: 1, paddingRight: 1, paddingBottom: 0,
      flexDirection: 'column',
    },
      h(Text, { color: C.green, bold: true }, `  Connected! ${models.length} models found`),
      h(Text, { color: C.dim }, '  Type to filter · ↓↑ to select · Enter to confirm'),
      h(Text, null, ''),
      h(Text, { color: C.cyan }, '  Filter:'),
      h(TextInput, {
        value: filter,
        onChange: (v) => { setFilter(v); setCursor(0); },
        placeholder: 'type to search...',
        focus: true,
      }),
      h(Text, null, ''),
      ...filtered.slice(0, maxShow).map((m, i) => {
        const active = i === cursor;
        return h(Text, { key: m.id },
          active ? h(Text, { color: C.green }, '▸ ') : h(Text, null, '  '),
          h(Text, { color: active ? C.text : C.dim, bold: active }, m.id),
        );
      }),
    ),
  );
}

// ── Step: Result ──

function StepDone({ provider, model, onClose }) {
  useInput((input, key) => { if (key.return || input === 'q') onClose(); });

  return h(Box, { flexDirection: 'column' },
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: C.green,
      borderTopColor: C.border,
      borderBottomColor: C.border,
      borderRightColor: C.border,
      paddingLeft: 1, paddingRight: 1, paddingBottom: 0,
      flexDirection: 'column',
    },
      h(Text, { color: C.green, bold: true }, '  ✓ Provider configured!'),
      h(Text, null, ''),
      h(Text, null, '  Provider  ', h(Text, { color: C.text }, provider.name)),
      h(Text, null, '  URL       ', h(Text, { color: C.dim }, provider.baseUrl)),
      h(Text, null, '  Model     ', h(Text, { color: C.lav }, model)),
      h(Text, null, ''),
      h(Text, { color: C.dim }, '  Press Enter to start chatting'),
    ),
  );
}

// ── Main Wizard ──

export function ProviderWizard({ onComplete, onCancel }) {
  const [phase, setPhase] = useState('preset'); // preset | details | testing | models | done
  const [preset, setPreset] = useState(null);
  const [record, setRecord] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [error, setError] = useState(null);

  const handlePreset = useCallback((p) => {
    setPreset(p);
    setPhase('details');
  }, []);

  const handleDetails = useCallback(async (rec) => {
    setRecord(rec);
    setPhase('testing');
    try {
      const result = await testNewProvider(rec);
      setModels(result.models);
      if (result.models.length) {
        setPhase('models');
      } else {
        // No models returned — save anyway
        const saved = addProvider(rec);
        setActiveProvider(saved.id);
        config.set('model', rec.models[0] || null);
        setPhase('done');
      }
    } catch (e) {
      // Save anyway but show error
      const saved = addProvider(rec);
      setActiveProvider(saved.id);
      setError(e.message);
      setPhase('done');
    }
  }, []);

  const handleModel = useCallback(async (modelId) => {
    setSelectedModel(modelId);
    if (record) {
      const saved = addProvider(record);
      setActiveProvider(saved.id);
      config.set('model', modelId);
    }
    setPhase('done');
  }, [record]);

  const handleClose = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  if (phase === 'preset') return h(StepPreset, { onSelect: handlePreset });
  if (phase === 'details') return h(StepDetails, { preset, onSubmit: handleDetails });
  if (phase === 'testing') return h(Box, null,
    h(Box, {
      borderStyle: 'single',
      borderLeftColor: C.orange,
      borderTopColor: C.border,
      borderBottomColor: C.border,
      borderRightColor: C.border,
      paddingLeft: 1, paddingRight: 1,
    },
      h(Text, { color: C.orange }, `  Connecting to ${record?.name || 'provider'}...`),
    ),
  );
  if (phase === 'models') return h(StepModel, { models, onSelect: handleModel });
  if (phase === 'done') return h(StepDone, { provider: record, model: selectedModel, onClose: handleClose });

  return null;
}
