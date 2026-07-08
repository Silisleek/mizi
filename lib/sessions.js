import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSIONS_DIR = join(homedir(), '.mizi', 'sessions');

function ensureDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id) {
  return join(SESSIONS_DIR, `${id}.json`);
}

export function createSession() {
  ensureDir();
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const session = {
    id,
    title: null,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: null,
    model: null,
  };
  writeFileSync(sessionPath(id), JSON.stringify(session, null, 2));
  return session;
}

export function saveSession(id, data) {
  ensureDir();
  const existing = loadSession(id) || {};
  const session = { ...existing, ...data, id, updatedAt: new Date().toISOString() };

  // Auto-generate title from first user message if not set
  if (!session.title && session.messages.length) {
    const firstUser = session.messages.find(m => m.role === 'user');
    if (firstUser) {
      session.title = firstUser.content.slice(0, 60).replace(/\n/g, ' ');
    }
  }

  writeFileSync(sessionPath(id), JSON.stringify(session, null, 2));
  return session;
}

export function loadSession(id) {
  try {
    const raw = readFileSync(sessionPath(id), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function listSessions() {
  ensureDir();
  try {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = files.map(f => {
      try {
        const raw = readFileSync(join(SESSIONS_DIR, f), 'utf-8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Sort by most recent
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sessions;
  } catch {
    return [];
  }
}

export function deleteSession(id) {
  try {
    unlinkSync(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

export function formatSessionPreview(session) {
  const date = new Date(session.updatedAt);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  let timeAgo;
  if (diffMin < 1) timeAgo = 'just now';
  else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
  else if (diffHr < 24) timeAgo = `${diffHr}h ago`;
  else timeAgo = `${diffDay}d ago`;

  const msgCount = session.messages?.length || 0;
  const title = session.title || '(untitled)';
  const model = session.model ? session.model.split('/').pop() : '';

  return { id: session.id, title, timeAgo, msgCount, model, session };
}
