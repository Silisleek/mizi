import { config } from './config.js';

const EFFORT = {
  instant:  { max_tokens: 1536,  temperature: 0.4, steps: 3  },
  fast:     { max_tokens: 3072,  temperature: 0.5, steps: 6  },
  normal:   { max_tokens: 8192,  temperature: 0.7, steps: 14 },
  compact:  { max_tokens: 1024,  temperature: 0.5, steps: 4  },
  power:    { max_tokens: 16384, temperature: 0.75, steps: 20 },
};

const REASONING = { low: 'low', medium: 'medium', high: 'high', max: 'max' };

export const EFFORTS = Object.keys(EFFORT);
export const REASONING_LEVELS = Object.keys(REASONING);

export async function fetchModels(providerId) {
  const prov = config.getProvider(providerId);
  if (!prov || !prov.baseUrl) return [];
  try {
    const res = await fetch(`${prov.baseUrl}/models`, {
      headers: prov.apiKey ? { 'Authorization': `Bearer ${prov.apiKey}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(m => ({ id: m.id, name: m.id }));
  } catch { return []; }
}

export async function* streamChat(messages, opts = {}) {
  const provId = opts.provider || config.get('provider');
  const prov = config.getProvider(provId);
  if (!prov) throw new Error(`Provider "${provId}" not found`);

  const model = opts.model || config.get('model');
  if (!model) throw new Error('No model selected. Use /model to pick one.');

  const effort = EFFORT[opts.effort || config.get('effort')] || EFFORT.normal;

  const body = {
    model,
    messages,
    max_tokens: opts.max_tokens || effort.max_tokens,
    temperature: opts.temperature ?? effort.temperature,
    stream: true,
  };

  const res = await fetch(`${prov.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(prov.apiKey ? { 'Authorization': `Bearer ${prov.apiKey}` } : {}),
      ...(prov.headers || {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) yield delta.content;
      } catch { /* skip malformed chunks */ }
    }
  }
}

export async function chatOnce(messages, opts = {}) {
  let result = '';
  for await (const chunk of streamChat(messages, opts)) result += chunk;
  return result;
}
