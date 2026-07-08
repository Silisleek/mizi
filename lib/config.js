import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.mizi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  provider: 'opencode',
  model: null,
  effort: 'normal',
  reasoning: 'medium',
  permission: 'ask',
  theme: 'dark',
  providers: {
    opencode: { name: 'OpenCode Zen', baseUrl: 'https://opencode.ai/zen/v1', apiKey: '', models: [] },
  },
};

class Config {
  constructor() {
    this.data = structuredClone(DEFAULTS);
    this.load();
  }

  load() {
    try {
      if (existsSync(CONFIG_FILE)) {
        const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
        this.data = { ...structuredClone(DEFAULTS), ...saved };
        if (saved.providers) {
          this.data.providers = { ...structuredClone(DEFAULTS.providers), ...saved.providers };
        }
      }
    } catch { /* use defaults */ }
  }

  save() {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2));
  }

  get(key) { return this.data[key]; }
  set(key, val) { this.data[key] = val; this.save(); }

  getProvider(id) { return this.data.providers[id]; }

  addProvider(id, cfg) {
    this.data.providers[id] = cfg;
    this.save();
  }

  removeProvider(id) {
    if (id === 'opencode') return false;
    delete this.data.providers[id];
    this.save();
    return true;
  }

  listProviders() { return this.data.providers; }
}

export const config = new Config();
