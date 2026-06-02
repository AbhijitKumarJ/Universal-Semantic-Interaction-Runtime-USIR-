import { readFile, writeFile, readdir, stat, type FSWatcher } from 'fs';
import { access, constants } from 'fs/promises';
import { promisify } from 'util';
import { join, resolve } from 'path';
import type { SecuritySandbox } from './sandbox';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);
const readdirAsync = promisify(readdir);
const statAsync = promisify(stat);

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modifiedAt: Date;
  permissions?: string;
}

export class FileSystemAdapter {
  private sandbox: SecuritySandbox;
  private watchers = new Map<string, FSWatcher>();

  constructor(sandbox: SecuritySandbox) {
    this.sandbox = sandbox;
  }

  getTools() {
    return [
      { name: 'os.fs.read', description: 'Read file contents as UTF-8 text', execute: async (args: Record<string, unknown>) => this.readFile(args) },
      { name: 'os.fs.write', description: 'Write text content to a file', execute: async (args: Record<string, unknown>) => this.writeFile(args) },
      { name: 'os.fs.list', description: 'List directory contents', execute: async (args: Record<string, unknown>) => this.listDir(args) },
      { name: 'os.fs.stat', description: 'Get file or directory metadata', execute: async (args: Record<string, unknown>) => this.getStat(args) },
      { name: 'os.fs.search', description: 'Search for files matching a pattern in a directory', execute: async (args: Record<string, unknown>) => this.searchFiles(args) },
    ];
  }

  private async readFile(args: Record<string, unknown>): Promise<{ content: string; path: string }> {
    const filePath = resolve(String(args.path ?? ''));
    const status = this.sandbox.check({ action: 'read_file', path: filePath, reason: 'Read file' });
    if (status === 'denied') throw new Error(`Permission denied: cannot read ${filePath}`);
    const content = await readFileAsync(filePath, 'utf-8');
    return { content, path: filePath };
  }

  private async writeFile(args: Record<string, unknown>): Promise<{ path: string; size: number }> {
    const filePath = resolve(String(args.path ?? ''));
    const content = String(args.content ?? '');
    const status = this.sandbox.check({ action: 'write_file', path: filePath, reason: 'Write file' });
    if (status === 'denied') throw new Error(`Permission denied: cannot write ${filePath}`);
    await writeFileAsync(filePath, content, 'utf-8');
    const s = await statAsync(filePath);
    return { path: filePath, size: s.size };
  }

  private async listDir(args: Record<string, unknown>): Promise<{ path: string; entries: FileEntry[] }> {
    const dirPath = resolve(String(args.path ?? '.'));
    const status = this.sandbox.check({ action: 'read_file', path: dirPath, reason: 'List directory' });
    if (status === 'denied') throw new Error(`Permission denied: cannot list ${dirPath}`);
    const names = await readdirAsync(dirPath);
    const entries: FileEntry[] = [];
    for (const name of names.slice(0, 200)) {
      try {
        const fullPath = join(dirPath, name);
        const s = await statAsync(fullPath);
        let permissions = '';
        try {
          await access(fullPath, constants.R_OK);
          permissions += 'r';
        } catch { permissions += '-'; }
        try {
          await access(fullPath, constants.W_OK);
          permissions += 'w';
        } catch { permissions += '-'; }
        entries.push({
          name,
          path: fullPath,
          size: s.size,
          isDirectory: s.isDirectory(),
          isFile: s.isFile(),
          modifiedAt: s.mtime,
          permissions,
        });
      } catch { /* skip unreadable entries */ }
    }
    return { path: dirPath, entries };
  }

  private async getStat(args: Record<string, unknown>): Promise<FileEntry | null> {
    const filePath = resolve(String(args.path ?? ''));
    const status = this.sandbox.check({ action: 'read_file', path: filePath, reason: 'Get file stats' });
    if (status === 'denied') throw new Error(`Permission denied`);
    try {
      const s = await statAsync(filePath);
      return {
        name: filePath.split('/').pop() ?? filePath,
        path: filePath,
        size: s.size,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        modifiedAt: s.mtime,
      };
    } catch {
      return null;
    }
  }

  private async searchFiles(args: Record<string, unknown>): Promise<{ pattern: string; results: string[] }> {
    const dirPath = resolve(String(args.path ?? '.'));
    const pattern = String(args.pattern ?? '');
    const status = this.sandbox.check({ action: 'read_file', path: dirPath, reason: 'Search files' });
    if (status === 'denied') throw new Error(`Permission denied`);
    const results: string[] = [];
    try {
      const names = await readdirAsync(dirPath);
      for (const name of names) {
        if (name.includes(pattern)) {
          results.push(join(dirPath, name));
        }
      }
    } catch { /* ignore */ }
    return { pattern, results };
  }
}
