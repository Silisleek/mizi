import { createInterface } from 'node:readline';
import { config } from './config.js';

const MODES = {
  'bypass':       { label: 'Bypass Permissions', desc: 'Auto-approve everything', ask: () => true },
  'accept-edits': { label: 'Accept Edits',       desc: 'Auto-approve file edits, ask for shell', ask: () => null },
  'ask':          { label: 'Ask',                desc: 'Ask before every action', ask: () => null },
  'plan':         { label: 'Plan Mode',          desc: 'Suggest only, never execute', ask: () => false },
};

export const PERMISSION_MODES = Object.keys(MODES);

export function getPermissionMode() {
  return config.get('permission') || 'ask';
}

export function getPermissionLabel(mode) {
  return MODES[mode]?.label || mode;
}

export function getPermissionDesc(mode) {
  return MODES[mode]?.desc || '';
}

export async function checkPermission(action, detail) {
  const mode = getPermissionMode();

  if (mode === 'bypass') return true;
  if (mode === 'plan') {
    console.log(`\x1b[33m[plan] Would ${action}: ${detail}\x1b[0m`);
    return false;
  }
  if (mode === 'accept-edits') {
    if (action === 'read_file' || action === 'write_file' || action === 'edit_file') return true;
  }

  // 'ask' mode (or fallback for accept-edits shell commands)
  return await promptUser(action, detail);
}

async function promptUser(action, detail) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    const label = action.replace(/_/g, ' ');
    rl.question(`\x1b[33mAllow ${label}?\x1b[0m \x1b[90m${truncate(detail, 80)}\x1b[0m \x1b[33m[y/n/e]\x1b[0m `, ans => {
      rl.close();
      const a = ans.trim().toLowerCase();
      if (a === 'y' || a === 'yes') resolve(true);
      else if (a === 'e' || a === 'edit') { config.set('permission', 'accept-edits'); resolve(true); }
      else if (a === 'b' || a === 'bypass') { config.set('permission', 'bypass'); resolve(true); }
      else resolve(false);
    });
  });
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
