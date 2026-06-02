import { SecuritySandbox } from './sandbox';
import { ProcessAdapter } from './process-adapter';
import { FileSystemAdapter } from './filesystem-adapter';
import { WindowAdapter } from './window-adapter';
import { SystemAdapter } from './system-adapter';
import { ShellAdapter } from './shell-adapter';

export interface Tool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface OsAdapterRegistration {
  adapterId: string;
  name: string;
  version: string;
  supportedRoles: string[];
  tools: Tool[];
  sandbox: SecuritySandbox;
}

export function createOsAdapterRegistration(config?: {
  allowedReadPaths?: string[];
  allowedWritePaths?: string[];
  allowedCommands?: string[];
  defaultPermission?: 'granted' | 'denied' | 'prompt';
}): OsAdapterRegistration {
  const sandbox = new SecuritySandbox(config);

  const processAdapter = new ProcessAdapter(sandbox);
  const fsAdapter = new FileSystemAdapter(sandbox);
  const windowAdapter = new WindowAdapter(sandbox);
  const systemAdapter = new SystemAdapter(sandbox);
  const shellAdapter = new ShellAdapter(sandbox);

  const tools: Tool[] = [
    ...processAdapter.getTools(),
    ...fsAdapter.getTools(),
    ...windowAdapter.getTools(),
    ...systemAdapter.getTools(),
    ...shellAdapter.getTools(),
  ];

  return {
    adapterId: 'os',
    name: 'OS Adapter',
    version: '0.1.0',
    supportedRoles: ['system', 'utility'],
    tools,
    sandbox,
  };
}
