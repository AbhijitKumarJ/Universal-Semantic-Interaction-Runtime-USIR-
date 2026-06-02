import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { platform, arch, hostname, totalmem, freemem, cpus, uptime, networkInterfaces, type as osType, release } from 'os';
import type { SecuritySandbox } from './sandbox';

export interface HostInfo {
  hostname: string;
  platform: string;
  arch: string;
  os: string;
  release: string;
  uptime: number;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  loadAverage: number[];
  networkInterfaces: string[];
}

export class SystemAdapter {
  private sandbox: SecuritySandbox;

  constructor(sandbox: SecuritySandbox) {
    this.sandbox = sandbox;
  }

  getTools() {
    return [
      { name: 'os.system.info', description: 'Get host system information (OS, CPU, memory, network)', execute: async () => this.getHostInfo() },
      { name: 'os.system.env', description: 'Get environment variable value', execute: async (args: Record<string, unknown>) => this.getEnv(args) },
      { name: 'os.system.clipboard', description: 'Read clipboard content (platform-dependent)', execute: async () => this.getClipboard() },
      { name: 'os.system.notify', description: 'Send a desktop notification', execute: async (args: Record<string, unknown>) => this.sendNotification(args) },
    ];
  }

  private async getHostInfo(): Promise<HostInfo> {
    const ifaces = networkInterfaces();
    return {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      os: osType(),
      release: release(),
      uptime: uptime(),
      cpus: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
      loadAverage: process.platform === 'linux' ? (() => { try {
        return readFileSync('/proc/loadavg', 'utf-8').split(' ').slice(0, 3).map(Number);
      } catch { return [0, 0, 0]; } })() : [0, 0, 0],
      networkInterfaces: Object.keys(ifaces),
    };
  }

  private async getEnv(args: Record<string, unknown>): Promise<{ key: string; value: string | undefined }> {
    const key = String(args.key ?? '');
    const status = this.sandbox.check({ action: 'read_env', reason: `Read env var ${key}` });
    if (status === 'denied') throw new Error('Permission denied: cannot read environment variables');
    return { key, value: process.env[key] };
  }

  private async getClipboard(): Promise<{ content: string }> {
    const status = this.sandbox.check({ action: 'access_clipboard', reason: 'Read clipboard' });
    if (status === 'denied') throw new Error('Permission denied: cannot access clipboard');
    try {
      const cmd = process.platform === 'darwin' ? 'pbpaste' : process.platform === 'win32' ? 'powershell Get-Clipboard' : 'xclip -o -selection clipboard 2>/dev/null || xsel -b 2>/dev/null';
      const content = execSync(cmd, { timeout: 3000 }).toString().trim();
      return { content };
    } catch {
      return { content: '' };
    }
  }

  private async sendNotification(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const title = String(args.title ?? 'USIR');
    const message = String(args.message ?? '');
    const status = this.sandbox.check({ action: 'send_notification', reason: `Send notification: ${title}` });
    if (status === 'denied') throw new Error('Permission denied: cannot send notification');
    try {
      if (process.platform === 'darwin') {
        execSync(`osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`, { timeout: 3000 });
      } else if (process.platform === 'linux') {
        execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`, { timeout: 3000 });
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }
}
