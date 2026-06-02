import { spawn, execSync, type ChildProcess } from 'child_process';
import type { SecuritySandbox } from './sandbox';

export interface ProcessInfo {
  pid: number;
  command: string;
  cpu?: number;
  memory?: number;
  state?: string;
}

export class ProcessAdapter {
  private sandbox: SecuritySandbox;
  private managed: Map<number, ChildProcess> = new Map();

  constructor(sandbox: SecuritySandbox) {
    this.sandbox = sandbox;
  }

  getTools() {
    return [
      {
        name: 'os.process.list',
        description: 'List running processes with PID, command, CPU, and memory',
        execute: async () => this.listProcesses(),
      },
      {
        name: 'os.process.spawn',
        description: 'Spawn a new process with given command and args',
        execute: async (args: Record<string, unknown>) => this.spawnProcess(args),
      },
      {
        name: 'os.process.signal',
        description: 'Send a signal to a process by PID',
        execute: async (args: Record<string, unknown>) => this.signalProcess(args),
      },
      {
        name: 'os.process.kill',
        description: 'Kill a process by PID',
        execute: async (args: Record<string, unknown>) => this.killProcess(args),
      },
      {
        name: 'os.process.monitor',
        description: 'Get resource usage for a specific process',
        execute: async (args: Record<string, unknown>) => this.monitorProcess(args),
      },
    ];
  }

  private async listProcesses(): Promise<ProcessInfo[]> {
    const status = this.sandbox.check({ action: 'manage_process', reason: 'List running processes' });
    if (status === 'denied') throw new Error('Permission denied: cannot list processes');

    const output = execSync('ps aux --no-headers 2>/dev/null || ps aux 2>/dev/null', { timeout: 5000 })
      .toString()
      .trim();
    if (!output) return [];

    return output.split('\n').slice(0, 100).map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1], 10),
        command: parts.slice(10).join(' '),
        cpu: parseFloat(parts[2]),
        memory: parseFloat(parts[3]),
        state: parts[7],
      };
    });
  }

  private async spawnProcess(args: Record<string, unknown>): Promise<{ pid: number; message: string }> {
    const cmd = String(args.command ?? '');
    const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];

    const status = this.sandbox.check({ action: 'execute_command', command: `${cmd} ${cmdArgs.join(' ')}`, reason: 'Spawn process' });
    if (status === 'denied') throw new Error('Permission denied: cannot spawn process');

    const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
    this.managed.set(child.pid!, child);
    child.unref();

    return { pid: child.pid!, message: `Process ${cmd} started with PID ${child.pid}` };
  }

  private async signalProcess(args: Record<string, unknown>): Promise<{ success: boolean }> {
    const pid = Number(args.pid);
    const signal = String(args.signal ?? 'SIGTERM');

    const status = this.sandbox.check({ action: 'manage_process', reason: `Send signal ${signal} to PID ${pid}` });
    if (status === 'denied') throw new Error('Permission denied');

    try {
      process.kill(pid, signal as any);
      return { success: true };
    } catch (err: any) {
      throw new Error(`Failed to signal process: ${err.message}`, { cause: err });
    }
  }

  private async killProcess(args: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.signalProcess({ ...args, signal: 'SIGKILL' });
  }

  private async monitorProcess(args: Record<string, unknown>): Promise<ProcessInfo | null> {
    const pid = Number(args.pid);
    const status = this.sandbox.check({ action: 'manage_process', reason: `Monitor PID ${pid}` });
    if (status === 'denied') throw new Error('Permission denied');

    try {
      const output = execSync(`ps -p ${pid} -o pid,comm,%cpu,%mem,state --no-headers 2>/dev/null`, { timeout: 3000 }).toString().trim();
      if (!output) return null;
      const parts = output.trim().split(/\s+/);
      return { pid: parseInt(parts[0], 10), command: parts[1], cpu: parseFloat(parts[2]), memory: parseFloat(parts[3]), state: parts[4] };
    } catch {
      return null;
    }
  }
}
