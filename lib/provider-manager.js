import { config } from './config.js';

const DEFAULT_PROVIDER_TYPE = 'openai-compatible';

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'provider';
}

function normalizeProvider(input = {}) {
  const models = Array.isArray(input.models)
    ? input.models.filter(Boolean).map(String)
    : typeof input.models === 'string'
      ? input.models.split(',').map(s => s.trim()).filter(Boolean)
      : [];

  return {
    name: input.name || input.id || 'Provider',
    type: input.type || DEFAULT_PROVIDER_TYPE,
    baseUrl: (input.baseUrl || '').trim(),
    apiKey: input.apiKey || '',
    models,
    enabled: input.enabled !== false,
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
    lastTest: input.lastTest || null,
  };
}

function loadProviders() {
  return config.get('providers') || {};
}

function saveProviders(providers) {
  config.set('providers', providers);
}

export function listProviders({ includeDisabled = true } = {}) {
  const providers = loadProviders();
  return Object.entries(providers)
    .filter(([, provider]) => includeDisabled || provider.enabled !== false)
    .map(([id, provider]) => ({ id, ...normalizeProvider(provider) }));
}

export function getProvider(id = config.get('provider')) {
  if (!id) return null;
  const providers = loadProviders();
  const provider = providers[id];
  if (!provider) return null;
  return { id, ...normalizeProvider(provider) };
}

export function getActiveProvider() {
  return getProvider(config.get('provider'));
}

export function setActiveProvider(id) {
  const provider = getProvider(id);
  if (!provider) {
    throw new Error(`Provider "${id}" not found`);
  }
  if (provider.enabled === false) {
    throw new Error(`Provider "${id}" is disabled`);
  }
  config.set('provider', id);
  return provider;
}

export function validateProvider(provider, { requireName = true } = {}) {
  const p = normalizeProvider(provider);
  const errors = [];
  if (requireName && !p.name.trim()) errors.push('Provider name is required');
  if (!p.baseUrl) errors.push('Base URL is required');
  else if (!/^https?:\/\//i.test(p.baseUrl)) errors.push('Base URL must start with http:// or https://');
  if (p.type === 'openai-compatible' && !p.apiKey && !p.baseUrl.includes('localhost') && !p.baseUrl.includes('127.0.0.1')) {
    errors.push('API key is required for remote providers');
  }
  return { ok: errors.length === 0, errors, provider: p };
}

export function upsertProvider(id, patch) {
  const providers = loadProviders();
  const current = providers[id] || {};
  const merged = normalizeProvider({ id, ...current, ...patch });
  providers[id] = merged;
  saveProviders(providers);
  return { id, ...merged };
}

export function addProvider(input) {
  const provider = normalizeProvider(input);
  const baseId = slugify(provider.name);
  const providers = loadProviders();
  let id = input.id || baseId;
  let suffix = 2;
  while (providers[id]) {
    id = `${baseId}-${suffix++}`;
  }
  providers[id] = provider;
  saveProviders(providers);
  return { id, ...provider };
}

export function removeProvider(id, { hard = false } = {}) {
  const providers = loadProviders();
  const provider = providers[id];
  if (!provider) return false;
  if (id === 'opencode' && !hard) return false;
  if (hard) {
    delete providers[id];
  } else {
    providers[id] = { ...provider, enabled: false };
  }
  saveProviders(providers);
  if (config.get('provider') === id) {
    const fallback = Object.entries(providers).find(([, p]) => p.enabled !== false);
    if (fallback) config.set('provider', fallback[0]);
  }
  return true;
}

export function setProviderModels(id, models) {
  return upsertProvider(id, { models });
}

export function setProviderTestResult(id, lastTest) {
  return upsertProvider(id, { lastTest });
}

export function buildProviderHeaders(provider) {
  const headers = {
    'Content-Type': 'application/json',
    ...(provider.headers || {}),
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

export async function testProvider(id) {
  const provider = getProvider(id);
  if (!provider) {
    return { ok: false, message: `Provider "${id}" not found` };
  }
  const start = Date.now();
  try {
    const models = await fetchProviderModels(provider);
    const result = {
      ok: true,
      message: `Connected to ${provider.name}`,
      latencyMs: Date.now() - start,
      modelsCount: models.length,
      models,
    };
    setProviderTestResult(id, {
      status: 'ok',
      message: result.message,
      latencyMs: result.latencyMs,
      at: new Date().toISOString(),
      modelsCount: models.length,
    });
    return result;
  } catch (error) {
    const message = error?.message || 'Unknown provider error';
    setProviderTestResult(id, {
      status: 'error',
      message,
      latencyMs: Date.now() - start,
      at: new Date().toISOString(),
    });
    return { ok: false, message };
  }
}

export async function fetchProviderModels(providerOrId) {
  const provider = typeof providerOrId === 'string' ? getProvider(providerOrId) : normalizeProvider(providerOrId);
  if (!provider) throw new Error('Provider not found');
  if (!provider.baseUrl) {
    if (provider.models.length) return provider.models.map(id => ({ id, name: id }));
    throw new Error(`Provider "${provider.name}" is missing a base URL`);
  }

  const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: buildProviderHeaders(provider),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`Model fetch failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const models = (data.data || []).map(m => ({ id: m.id, name: m.id }));
  if (models.length) {
    setProviderModels(provider.id || provider.name, models.map(m => m.id));
  }
  return models;
}

export function ensureActiveProvider() {
  const active = getActiveProvider();
  if (active && active.enabled !== false) return active;
  const firstEnabled = listProviders().find(p => p.enabled !== false);
  if (firstEnabled) {
    config.set('provider', firstEnabled.id);
    return firstEnabled;
  }
  return null;
}

export function providerSummary(provider) {
  if (!provider) return 'No provider';
  const parts = [provider.name];
  if (provider.type) parts.push(provider.type);
  if (provider.baseUrl) parts.push(provider.baseUrl);
  return parts.join(' · ');
}
