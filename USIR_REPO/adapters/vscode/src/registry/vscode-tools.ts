import * as vscode from 'vscode';
import { ToolRegistry } from './tool-registry';

const TYPE_MAP: Record<string, vscode.SymbolKind> = {
  function: vscode.SymbolKind.Function,
  class: vscode.SymbolKind.Class,
  variable: vscode.SymbolKind.Variable,
  method: vscode.SymbolKind.Method,
  interface: vscode.SymbolKind.Interface,
  enum: vscode.SymbolKind.Enum,
};

function toUri(entityId: string): vscode.Uri {
  if (entityId.startsWith('file://')) {
    return vscode.Uri.parse(entityId);
  }
  return vscode.Uri.file(entityId);
}

export class VSCodeToolRegistry extends ToolRegistry {
  constructor() {
    super();
    this.registerVSCodeTools();
  }

  private registerVSCodeTools(): void {
    this.register({
      name: 'vscode.openEntity',
      description:
        'Open a file or entity in the editor. Args: { entityId: string, cursor?: { line, column } }',
      execute: async (args) => {
        const { entityId, cursor } = args as {
          entityId: string;
          cursor?: { line: number; column: number };
        };
        const uri = toUri(entityId);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        if (cursor) {
          const pos = new vscode.Position(
            Math.max(0, cursor.line - 1),
            Math.max(0, cursor.column - 1),
          );
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos));
        }
        return {
          success: true,
          affectedEntityIds: [entityId],
          provenanceId: `prov-open-${Date.now()}`,
        };
      },
    });

    this.register({
      name: 'vscode.focusRegion',
      description:
        'Move focus to a specific IDE region. Args: { region: "editor"|"explorer"|"terminal"|"search"|"debug"|"extensions"|"settings"|"problems"|"output"|"source-control" }',
      execute: async (args) => {
        const { region } = args as { region: string };
        const regionMap: Record<string, string> = {
          editor: 'workbench.action.focusActiveEditorGroup',
          explorer: 'workbench.view.explorer',
          terminal: 'workbench.view.terminal',
          search: 'workbench.view.search',
          debug: 'workbench.view.debug',
          extensions: 'workbench.view.extensions',
          settings: 'workbench.action.openSettings',
          problems: 'workbench.actions.view.problems',
          output: 'workbench.action.output.toggleOutput',
          'source-control': 'workbench.view.scm',
        };
        const cmd = regionMap[region] ?? 'workbench.action.focusActiveEditorGroup';
        await vscode.commands.executeCommand(cmd);
        return { success: true, affectedEntityIds: [], metadata: { region } };
      },
    });

    this.register({
      name: 'vscode.editEntity',
      description:
        'Edit a file. Args: { entityId: string, operation: "replace"|"insert"|"delete", value: string }',
      execute: async (args) => {
        const { entityId, operation, value } = args as {
          entityId: string;
          operation: string;
          value: string;
        };
        const uri = toUri(entityId);

        switch (operation) {
          case 'replace': {
            const edit = new vscode.WorkspaceEdit();
            const doc = await vscode.workspace.openTextDocument(uri);
            const last = doc.positionAt(doc.getText().length);
            const fullRange = new vscode.Range(new vscode.Position(0, 0), last);
            edit.replace(uri, fullRange, value);
            await vscode.workspace.applyEdit(edit);
            break;
          }
          case 'insert': {
            const edit = new vscode.WorkspaceEdit();
            const doc = await vscode.workspace.openTextDocument(uri);
            const pos = doc.positionAt(doc.getText().length);
            edit.insert(uri, pos, value);
            await vscode.workspace.applyEdit(edit);
            break;
          }
          case 'delete': {
            const edit = new vscode.WorkspaceEdit();
            const doc = await vscode.workspace.openTextDocument(uri);
            const last = doc.positionAt(doc.getText().length);
            const fullRange = new vscode.Range(new vscode.Position(0, 0), last);
            edit.delete(uri, fullRange);
            await vscode.workspace.applyEdit(edit);
            break;
          }
          default: {
            throw new Error(`Unknown edit operation: ${operation}`);
          }
        }

        return {
          success: true,
          affectedEntityIds: [entityId],
          provenanceId: `prov-edit-${Date.now()}`,
          metadata: { operation },
        };
      },
    });

    this.register({
      name: 'vscode.executeCommand',
      description:
        'Run a VS Code command by id. Args: { command: string, args?: any[] }',
      execute: async (args) => {
        const { command, args: cmdArgs = [] } = args as {
          command: string;
          args?: unknown[];
        };
        const result = await vscode.commands.executeCommand(command, ...cmdArgs);
        return {
          success: true,
          affectedEntityIds: [],
          provenanceId: `prov-cmd-${Date.now()}`,
          metadata: { command, result },
        };
      },
    });

    this.register({
      name: 'vscode.runTests',
      description:
        'Run tests for a file or test entity. Args: { entityId?: string, testName?: string }',
      execute: async (args) => {
        const { entityId, testName } = args as {
          entityId?: string;
          testName?: string;
        };
        if (entityId) {
          const uri = toUri(entityId);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
        }
        await vscode.commands.executeCommand('testing.runAll');
        return {
          success: true,
          affectedEntityIds: entityId ? [entityId] : [],
          provenanceId: `prov-test-${Date.now()}`,
          metadata: { testName },
        };
      },
    });

    this.register({
      name: 'vscode.runInTerminal',
      description:
        'Execute a command in the integrated terminal. Args: { command: string }',
      execute: async (args) => {
        const { command } = args as { command: string };
        const terminal =
          vscode.window.terminals.find((t) => t.name === 'USIR') ??
          vscode.window.createTerminal('USIR');
        terminal.show();
        terminal.sendText(command);
        return {
          success: true,
          affectedEntityIds: [],
          provenanceId: `prov-term-${Date.now()}`,
          metadata: { command },
        };
      },
    });

    this.register({
      name: 'vscode.search',
      description:
        'Search across the workspace. Args: { query: string, scope?: string }',
      execute: async (args) => {
        const { query, scope } = args as { query: string; scope?: string };
        const includePattern = scope
          ? `**/${scope}/**`
          : '**/*';
        const results = await vscode.workspace.findFiles(includePattern, '**/node_modules/**', 200);
        const filtered = results.filter((uri) =>
          uri.fsPath.toLowerCase().includes(query.toLowerCase()),
        );
        await vscode.commands.executeCommand('workbench.view.search');
        return {
          success: true,
          affectedEntityIds: filtered.map((r) => r.toString()),
          provenanceId: `prov-search-${Date.now()}`,
          metadata: { query, scope, matchCount: filtered.length },
        };
      },
    });

    this.register({
      name: 'vscode.locateSymbol',
      description:
        'Find a symbol by name. Args: { name: string, kind?: "function"|"class"|"variable"|"method"|"interface"|"enum" }',
      execute: async (args) => {
        const { name, kind } = args as { name: string; kind?: string };
        const allSymbols =
          (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            name,
          )) ?? [];
        const kindFilter = kind ? TYPE_MAP[kind] : undefined;
        const matched = kindFilter !== undefined
          ? allSymbols.filter((s) => s.kind === kindFilter)
          : allSymbols;
        const entities = matched.map((s) => ({
          name: s.name,
          kind: s.kind,
          file: s.location.uri.fsPath,
          range: `${s.location.range.start.line}:${s.location.range.start.character}`,
        }));
        return {
          success: true,
          affectedEntityIds: matched.map((s) => s.location.uri.toString()),
          provenanceId: `prov-symbol-${Date.now()}`,
          metadata: { name, kind, matchCount: matched.length, symbols: entities },
        };
      },
    });

    this.register({
      name: 'vscode.applyRefactor',
      description:
        'Apply a code refactoring. Args: { refactorType: string, entityId: string, args?: Record<string, unknown> }',
      execute: async (args) => {
        const { refactorType, entityId } = args as {
          refactorType: string;
          entityId: string;
          args?: Record<string, unknown>;
        };
        const uri = toUri(entityId);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
          'vscode.executeCodeActionProvider',
          uri,
          new vscode.Range(0, 0, 0, 0),
        );
        const matching = (codeActions ?? []).filter(
          (a) =>
            a.title.toLowerCase().includes(refactorType.toLowerCase()) ||
            (a.kind && a.kind.value.toLowerCase().includes(refactorType.toLowerCase())),
        );
        if (matching.length > 0) {
          await vscode.commands.executeCommand('editor.action.codeAction', {
            kind: matching[0]!.kind?.value,
          });
        }
        return {
          success: true,
          affectedEntityIds: [entityId],
          provenanceId: `prov-refactor-${Date.now()}`,
          metadata: { refactorType, actionsFound: matching.length },
        };
      },
    });
  }
}
