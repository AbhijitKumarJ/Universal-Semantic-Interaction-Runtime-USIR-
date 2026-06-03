import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VSCodeToolRegistry } from './vscode-tools';

vi.mock('vscode', () => {
  class MockWorkspaceEdit {
    replace = vi.fn();
    insert = vi.fn();
    delete = vi.fn();
  }
  class MockPosition {
    constructor(public line: number, public character: number) {}
  }
  class MockRange {
    constructor(public start: MockPosition, public end: MockPosition) {}
  }
  class MockSelection {
    constructor(public start: MockPosition, public end: MockPosition) {}
  }
  return {
    Uri: {
      parse: (s: string) => ({ scheme: 'file', path: s.replace('file://', ''), fsPath: s, toString: () => s }),
      file: (s: string) => ({ scheme: 'file', fsPath: s, toString: () => `file://${s}` }),
    },
    Position: MockPosition as any,
    Range: MockRange as any,
    Selection: MockSelection as any,
    SymbolKind: { Function: 1, Class: 2, Variable: 3, Method: 4, Interface: 5, Enum: 6 },
    WorkspaceEdit: MockWorkspaceEdit as any,
    window: {
      showTextDocument: vi.fn().mockResolvedValue({ selection: {}, revealRange: vi.fn() }),
      createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn() }),
      terminals: [],
    },
    workspace: {
      openTextDocument: vi.fn().mockResolvedValue({
        getText: () => 'file content',
        positionAt: () => new MockPosition(0, 0),
      }),
      applyEdit: vi.fn().mockResolvedValue(true),
      findFiles: vi.fn().mockResolvedValue([]),
    },
    commands: {
      executeCommand: vi.fn().mockResolvedValue([]),
    },
  };
});

describe('VSCodeToolRegistry', () => {
  let registry: VSCodeToolRegistry;

  beforeEach(() => {
    registry = new VSCodeToolRegistry();
  });

  it('registers all 9 VS Code tools', () => {
    const tools = registry.list();
    expect(tools).toHaveLength(9);
  });

  it('registers vscode.openEntity', () => {
    const tool = registry.getTool('vscode.openEntity');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('Open a file');
  });

  it('registers vscode.editEntity', () => {
    const tool = registry.getTool('vscode.editEntity');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('Edit a file');
  });

  it('registers vscode.executeCommand', () => {
    const tool = registry.getTool('vscode.executeCommand');
    expect(tool).toBeDefined();
  });

  it('registers vscode.runTests', () => {
    const tool = registry.getTool('vscode.runTests');
    expect(tool).toBeDefined();
  });

  it('registers vscode.runInTerminal', () => {
    const tool = registry.getTool('vscode.runInTerminal');
    expect(tool).toBeDefined();
  });

  it('registers vscode.search', () => {
    const tool = registry.getTool('vscode.search');
    expect(tool).toBeDefined();
  });

  it('registers vscode.locateSymbol', () => {
    const tool = registry.getTool('vscode.locateSymbol');
    expect(tool).toBeDefined();
  });

  it('registers vscode.applyRefactor', () => {
    const tool = registry.getTool('vscode.applyRefactor');
    expect(tool).toBeDefined();
  });

  it('registers vscode.focusRegion', () => {
    const tool = registry.getTool('vscode.focusRegion');
    expect(tool).toBeDefined();
  });

  it('every tool has a non-empty description', () => {
    const tools = registry.list();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('toJSON returns serializable tool list', () => {
    const json = registry.toJSON();
    expect(json).toHaveLength(9);
    for (const entry of json) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
    }
  });

  it('vscode.openEntity execution returns success shape', async () => {
    const tool = registry.getTool('vscode.openEntity')!;
    const result = await tool.execute({ entityId: 'file:///test.ts' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('provenanceId');
  });

  it('vscode.focusRegion execution returns success shape', async () => {
    const tool = registry.getTool('vscode.focusRegion')!;
    const result = await tool.execute({ region: 'editor' });
    expect(result).toHaveProperty('success', true);
  });

  it('vscode.editEntity replace execution returns success shape', async () => {
    const tool = registry.getTool('vscode.editEntity')!;
    const result = await tool.execute({ entityId: 'file:///test.ts', operation: 'replace', value: 'new content' });
    expect(result).toHaveProperty('success', true);
  });

  it('vscode.editEntity throws on unknown operation', async () => {
    const tool = registry.getTool('vscode.editEntity')!;
    await expect(tool.execute({ entityId: 'file:///test.ts', operation: 'unknown', value: '' })).rejects.toThrow('Unknown edit operation');
  });
});
