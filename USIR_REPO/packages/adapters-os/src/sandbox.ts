export interface PermissionRequest {
  action: 'read_file' | 'write_file' | 'execute_command' | 'manage_process' | 'manage_window' | 'access_clipboard' | 'send_notification' | 'read_env';
  path?: string;
  command?: string;
  reason: string;
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

export interface SandboxConfig {
  allowedReadPaths: string[];
  allowedWritePaths: string[];
  allowedCommands: string[];
  deniedCommands: string[];
  defaultPermission: PermissionStatus;
}

export class SecuritySandbox {
  private permissions = new Map<string, PermissionStatus>();
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      allowedReadPaths: config?.allowedReadPaths ?? [],
      allowedWritePaths: config?.allowedWritePaths ?? [],
      allowedCommands: config?.allowedCommands ?? [],
      deniedCommands: config?.deniedCommands ?? ['rm -rf /', 'shutdown', 'reboot', 'init 0', 'dd'],
      defaultPermission: config?.defaultPermission ?? 'prompt',
    };
  }

  check(request: PermissionRequest): PermissionStatus {
    const cacheKey = this.cacheKey(request);
    const cached = this.permissions.get(cacheKey);
    if (cached) return cached;

    const result = this.evaluate(request);
    if (result !== 'prompt') {
      this.permissions.set(cacheKey, result);
      return result;
    }

    const fallback = this.config.defaultPermission;
    this.permissions.set(cacheKey, fallback);
    return fallback;
  }

  grant(request: PermissionRequest): void {
    this.permissions.set(this.cacheKey(request), 'granted');
  }

  deny(request: PermissionRequest): void {
    this.permissions.set(this.cacheKey(request), 'denied');
  }

  reset(): void {
    this.permissions.clear();
  }

  private evaluate(request: PermissionRequest): PermissionStatus {
    if (request.action === 'read_file' || request.action === 'write_file') {
      return this.evaluateFileAccess(request);
    }
    if (request.action === 'execute_command') {
      return this.evaluateCommand(request);
    }
    if (this.config.defaultPermission !== 'prompt') {
      return this.config.defaultPermission;
    }
    return 'prompt';
  }

  private evaluateFileAccess(request: PermissionRequest): PermissionStatus {
    if (!request.path) return 'denied';
    const allowed = request.action === 'read_file' ? this.config.allowedReadPaths : this.config.allowedWritePaths;
    const matches = allowed.some((prefix) => request.path!.startsWith(prefix));
    return matches ? 'granted' : (this.config.defaultPermission !== 'prompt' ? this.config.defaultPermission : 'prompt');
  }

  private evaluateCommand(request: PermissionRequest): PermissionStatus {
    if (!request.command) return 'denied';
    const cmd = request.command.trim().split(/\s+/)[0] ?? '';
    if (this.config.deniedCommands.some((d) => request.command!.startsWith(d))) return 'denied';
    if (this.config.allowedCommands.length === 0) return 'prompt';
    const allowed = this.config.allowedCommands.some((a) => cmd === a || request.command!.startsWith(a));
    return allowed ? 'granted' : 'prompt';
  }

  private cacheKey(request: PermissionRequest): string {
    return `${request.action}:${request.path ?? ''}:${request.command ?? ''}`;
  }
}
