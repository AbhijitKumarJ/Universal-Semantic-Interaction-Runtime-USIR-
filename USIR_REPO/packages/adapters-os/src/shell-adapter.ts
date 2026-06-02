import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import type { SecuritySandbox } from './sandbox';
import type { Writable } from 'stream';

const execAsync = promisify(exec);

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class ShellAdapter {
  private sandbox: SecuritySandbox;
  private activeShells: Map<string, ChildProcess> = new Map();
  private shellCounter = 0;

  constructor(sandbox: SecuritySandbox) {
    this.sandbox = sandbox;
  }

  getTools() {
    return [
      {
        name: 'os.shell.exec',
        description: 'Execute a shell command and return output',
        execute: async (args: Record<string, unknown>) => this.execCommand(args),
      },
      {
        name: 'os.shell.pipe',
        description: 'Pipe input to an active shell session and get output',
        execute: async (args: Record<string, unknown>) => this.pipeShell(args),
      },
    ];
  }

  private async execCommand(args: Record<string, unknown>): Promise<ShellResult> {
    const command = String(args.command ?? '');
    const timeout = Number(args.timeout ?? 30000);

    const status = this.sandbox.check({ action: 'execute_command', command, reason: 'Execute shell command' });
    if (status === 'denied') throw new Error(`Permission denied: cannot execute command`);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout, maxBuffer: 1024 * 1024 });
      return { command, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
    } catch (err: any) {
      return {
        command,
        stdout: err.stdout?.toString().trim() ?? '',
        stderr: err.stderr?.toString().trim() ?? err.message,
        exitCode: err.code ?? 1,
      };
    }
  }

  private async pipeShell(args: Record<string, unknown>): Promise<{ sessionId: string; output: string }> {
    const sessionId = String(args.sessionId ?? '');
    const input = String(args.input ?? '');

    let shell: ChildProcess;
    if (sessionId && this.activeShells.has(sessionId)) {
      shell = this.activeShells.get(sessionId)!;
      const stdin = shell.stdin as Writable;
      stdin.write(input + '\n');
      return { sessionId, output: '' };
    }

    const id = sessionId || `shell_${++this.shellCounter}`;
    shell = spawn(process.platform === 'win32' ? 'cmd' : 'sh', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.activeShells.set(id, shell);

    let output = '';
    shell.stdout?.on('data', (data: Buffer) => { output += data.toString(); });

    if (input) {
      shell.stdin?.write(input + '\n');
    }

    return { sessionId: id, output };
  }
}
