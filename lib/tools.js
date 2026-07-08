import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { checkPermission } from './permissions.js';

const CWD = process.cwd();

function safePath(p) {
  const full = resolve(CWD, p);
  if (!full.startsWith(CWD)) throw new Error('Path outside project directory');
  return full;
}

export const tools = [
  {
    name: 'read_file',
    desc: 'Read a file',
    params: { path: 'string' },
    async execute({ path }) {
      const ok = await checkPermission('read_file', path);
      if (!ok) return { error: 'Permission denied' };
      try {
        const full = safePath(path);
        return { content: readFileSync(full, 'utf-8') };
      } catch (e) { return { error: e.message }; }
    },
  },
  {
    name: 'write_file',
    desc: 'Write/create a file',
    params: { path: 'string', content: 'string' },
    async execute({ path, content }) {
      const ok = await checkPermission('write_file', `${path} (${content.length} chars)`);
      if (!ok) return { error: 'Permission denied' };
      try {
        const full = safePath(path);
        const dir = dirname(full);
        if (!existsSync(dir)) {
          const { mkdirSync } = await import('node:fs');
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(full, content, 'utf-8');
        return { success: true, path: full };
      } catch (e) { return { error: e.message }; }
    },
  },
  {
    name: 'edit_file',
    desc: 'Edit a file by replacing text',
    params: { path: 'string', old_text: 'string', new_text: 'string' },
    async execute({ path, old_text, new_text }) {
      const ok = await checkPermission('edit_file', `${path} (replace ${old_text.length} chars)`);
      if (!ok) return { error: 'Permission denied' };
      try {
        const full = safePath(path);
        let content = readFileSync(full, 'utf-8');
        if (!content.includes(old_text)) return { error: 'Text not found in file' };
        content = content.replace(old_text, new_text);
        writeFileSync(full, content, 'utf-8');
        return { success: true, path: full };
      } catch (e) { return { error: e.message }; }
    },
  },
  {
    name: 'list_files',
    desc: 'List files in a directory',
    params: { path: 'string' },
    async execute({ path }) {
      const ok = await checkPermission('list_files', path || '.');
      if (!ok) return { error: 'Permission denied' };
      try {
        const { readdirSync } = await import('node:fs');
        const full = safePath(path || '.');
        const entries = readdirSync(full, { withFileTypes: true });
        return { files: entries.map(e => ({ name: e.name, isDir: e.isDirectory() })) };
      } catch (e) { return { error: e.message }; }
    },
  },
  {
    name: 'run_command',
    desc: 'Run a shell command',
    params: { command: 'string' },
    async execute({ command }) {
      const ok = await checkPermission('run_command', command);
      if (!ok) return { error: 'Permission denied' };
      try {
        const output = execSync(command, { cwd: CWD, timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return { stdout: output.trim() };
      } catch (e) {
        return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status };
      }
    },
  },
];

export function getToolDefinitions() {
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.desc, parameters: { type: 'object', properties: t.params, required: Object.keys(t.params) } },
  }));
}

export async function executeTool(name, args) {
  const tool = tools.find(t => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  return await tool.execute(args);
}

export function getToolByName(name) {
  return tools.find(t => t.name === name);
}
