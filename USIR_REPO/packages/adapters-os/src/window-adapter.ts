import { execSync } from 'child_process';
import type { SecuritySandbox } from './sandbox';

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isFocused: boolean;
}

export class WindowAdapter {
  private sandbox: SecuritySandbox;

  constructor(sandbox: SecuritySandbox) {
    this.sandbox = sandbox;
  }

  getTools() {
    return [
      { name: 'os.window.list', description: 'List open windows', execute: async () => this.listWindows() },
      { name: 'os.window.focus', description: 'Focus a window by ID', execute: async (args: Record<string, unknown>) => this.focusWindow(args) },
      { name: 'os.window.resize', description: 'Move and resize a window', execute: async (args: Record<string, unknown>) => this.resizeWindow(args) },
      { name: 'os.window.minimize', description: 'Minimize a window', execute: async (args: Record<string, unknown>) => this.minimizeWindow(args) },
      { name: 'os.window.restore', description: 'Restore a minimized window', execute: async (args: Record<string, unknown>) => this.restoreWindow(args) },
    ];
  }

  private async listWindows(): Promise<WindowInfo[]> {
    const status = this.sandbox.check({ action: 'manage_window', reason: 'List windows' });
    if (status === 'denied') throw new Error('Permission denied');

    if (process.platform === 'linux') {
      return this.listWindowsLinux();
    } else if (process.platform === 'darwin') {
      return this.listWindowsMac();
    }
    return [];
  }

  private async focusWindow(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const id = String(args.id ?? '');
    const status = this.sandbox.check({ action: 'manage_window', reason: `Focus window ${id}` });
    if (status === 'denied') throw new Error('Permission denied');
    try {
      if (process.platform === 'linux') {
        execSync(`wmctrl -ia ${id}`, { timeout: 3000 });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async resizeWindow(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const id = String(args.id ?? '');
    const x = Number(args.x ?? 0);
    const y = Number(args.y ?? 0);
    const w = Number(args.width ?? 800);
    const h = Number(args.height ?? 600);
    const status = this.sandbox.check({ action: 'manage_window', reason: `Resize window ${id}` });
    if (status === 'denied') throw new Error('Permission denied');
    try {
      if (process.platform === 'linux') {
        execSync(`wmctrl -ir ${id} -e 0,${x},${y},${w},${h}`, { timeout: 3000 });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async minimizeWindow(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const id = String(args.id ?? '');
    const status = this.sandbox.check({ action: 'manage_window', reason: `Minimize window ${id}` });
    if (status === 'denied') throw new Error('Permission denied');
    try {
      if (process.platform === 'linux') {
        execSync(`wmctrl -ir ${id} -b add,hidden`, { timeout: 3000 });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async restoreWindow(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const id = String(args.id ?? '');
    const status = this.sandbox.check({ action: 'manage_window', reason: `Restore window ${id}` });
    if (status === 'denied') throw new Error('Permission denied');
    try {
      if (process.platform === 'linux') {
        execSync(`wmctrl -ir ${id} -b remove,hidden`, { timeout: 3000 });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private listWindowsLinux(): WindowInfo[] {
    try {
      const output = execSync('wmctrl -lG 2>/dev/null', { timeout: 3000 }).toString().trim();
      if (!output) return [];
      return output.split('\n').map((line) => {
        const parts = line.trim().split(/\s+/);
        const id = parts[0]!;
        const x = parseInt(parts[2], 10);
        const y = parseInt(parts[3], 10);
        const w = parseInt(parts[4], 10);
        const h = parseInt(parts[5], 10);
        const app = parts[6] ?? '';
        const title = parts.slice(7).join(' ') ?? '';
        return { id, title, app, x, y, width: w, height: h, isMinimized: false, isFocused: false };
      });
    } catch {
      return [];
    }
  }

  private listWindowsMac(): WindowInfo[] {
    try {
      const output = execSync('osascript -e \'tell application "System Events" to get name of every process whose visible is true\' 2>/dev/null', { timeout: 3000 }).toString().trim();
      return output.split(',').map((app, i) => ({
        id: String(i),
        title: app.trim(),
        app: app.trim(),
        x: 0, y: 0, width: 0, height: 0,
        isMinimized: false, isFocused: false,
      }));
    } catch {
      return [];
    }
  }
}
