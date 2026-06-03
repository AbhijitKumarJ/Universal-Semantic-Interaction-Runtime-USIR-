import * as vscode from 'vscode';
import { SnapshotEngine, VSCodeToolRegistry } from '@usir/vscode-adapter';
import { createEntity } from '@usir/protocol/entities';
import { LLMRouter } from '@usir/runtime';
import { TopologicalExecutor } from '@usir/runtime';
import { ProvenanceStore } from '@usir/runtime';
import { InteractionMemory } from '@usir/runtime';
import { TrustClassifier } from '@usir/runtime';
import { A2UDispatcher } from '@usir/runtime';
import { type STTProvider, FastWhisperClient, LocalWhisperClient, FallbackWhisperClient, buildFusedIntent, type PointingTarget, type ImplicitSignals } from '@usir/audio-pipeline';
import { WebviewAudioCapture } from './audio/webview-audio-capture';

let snapshotEngine: SnapshotEngine;
let toolRegistry: VSCodeToolRegistry;
let llmRouter: LLMRouter;
let executor: TopologicalExecutor;
let provenanceStore: ProvenanceStore;
let interactionMemory: InteractionMemory;
let a2uDispatcher: A2UDispatcher;
let audioCapture: WebviewAudioCapture | null = null;
let whisperClient: STTProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('USIR extension activating...');

  // 1. Initialize the snapshot engine with the current active editor
  const activeEditor = vscode.window.activeTextEditor;
  const initialEntity = createEntity({
    id: activeEditor
      ? activeEditor.document.uri.toString()
      : 'file:///untitled',
    role: 'source_file',
    displayName: activeEditor?.document.fileName ?? 'untitled',
  });
  snapshotEngine = new SnapshotEngine(initialEntity);

  // 2. Initialize the tool registry
  toolRegistry = new VSCodeToolRegistry();

  // 3. Initialize the LLM router (read API key from settings)
  const config = vscode.workspace.getConfiguration('usir');
  const apiKey =
    (config.get('openaiApiKey') as string) ?? process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) {
    vscode.window.showWarningMessage(
      'USIR: No OpenAI API key configured. Set `usir.openaiApiKey` in settings.',
    );
  }
  llmRouter = new LLMRouter({
    config: {
      endpoint:
        (config.get('llmEndpoint') as string) ?? 'https://api.openai.com/v1',
      apiKey,
      model: (config.get('llmModel') as string) ?? 'gpt-4o',
      temperature: 0,
    },
    getToolRegistryJson: async () => JSON.stringify(toolRegistry.toJSON()),
    getAvailableEntityIds: async () =>
      Array.from(snapshotEngine.cold.exportGraph().nodes.keys()),
  });

  // 4. Initialize executor, provenance, memory
  executor = new TopologicalExecutor(toolRegistry);
  provenanceStore = new ProvenanceStore();
  interactionMemory = new InteractionMemory('user-1');

  // 5. Initialize A2U dispatcher
  const trustClassifier = new TrustClassifier();
  a2uDispatcher = new A2UDispatcher(
    trustClassifier,
    provenanceStore,
    executor,
  );

  // 6. Initialize whisper client with local-first fallback
  const fastWhisper = new FastWhisperClient({
    apiKey:
      (config.get('groqApiKey') as string) ?? process.env.GROQ_API_KEY ?? '',
  });
  const localWhisper = new LocalWhisperClient({
    binaryPath: config.get('localWhisperBinary') as string | undefined,
    modelPath: config.get('localWhisperModel') as string | undefined,
  });
  whisperClient = new FallbackWhisperClient(localWhisper, fastWhisper);

  // 7. Register VS Code event listeners -> update snapshot engine
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const entity = createEntity({
          id: editor.document.uri.toString(),
          role: 'source_file',
          displayName: editor.document.fileName.split('/').pop() ?? 'untitled',
        });
        snapshotEngine.hot.updateActiveEntity(entity);
        interactionMemory.pushToHistory(entity.id);
      }
    }),

    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) {
        const entity = createEntity({
          id: e.textEditor.document.uri.toString(),
          role: 'source_file',
          displayName:
            e.textEditor.document.fileName.split('/').pop() ?? 'untitled',
        });
        snapshotEngine.hot.updateSelection([entity]);

        // Also update pointer target based on cursor position
        const pos = e.selections[0]?.active;
        if (pos) {
          snapshotEngine.hot.updatePointerTarget({
            entityId: entity.id,
            bounds: {
              x: pos.character,
              y: pos.line,
              width: 1,
              height: 1,
            },
          });
        }
      }
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      const entity = createEntity({
        id: e.document.uri.toString(),
        role: 'source_file',
        displayName: e.document.fileName.split('/').pop() ?? 'untitled',
      });
      snapshotEngine.cold.addEntity(entity);
      snapshotEngine.warm.recordChange(entity, {
        version: e.document.version,
      });
    }),

    vscode.workspace.onDidOpenTextDocument((doc) => {
      const entity = createEntity({
        id: doc.uri.toString(),
        role: 'source_file',
        displayName: doc.fileName.split('/').pop() ?? 'untitled',
      });
      snapshotEngine.cold.addEntity(entity);
    }),

    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        snapshotEngine.hot.updateActiveEntity(
          snapshotEngine.hot.activeEntity,
          'editor',
        );
      }
    }),
  );

  // 8. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('usir.startListening', () =>
      startListening(context),
    ),
    vscode.commands.registerCommand('usir.stopListening', () => stopListening()),
    vscode.commands.registerCommand('usir.showSnapshot', () => showSnapshot()),
    vscode.commands.registerCommand('usir.showProvenance', () =>
      showProvenance(),
    ),
  );

  // 9. Show status bar item
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = '$(mic) USIR';
  statusBar.tooltip = 'USIR -- press Ctrl+Shift+Space to start voice';
  statusBar.command = 'usir.startListening';
  statusBar.show();
  context.subscriptions.push(statusBar);

  console.log('USIR extension activated.');
}

export function deactivate() {
  if (audioCapture) {
    audioCapture.stop();
    audioCapture = null;
  }
}

async function startListening(context: vscode.ExtensionContext) {
  if (audioCapture) {
    vscode.window.showInformationMessage('USIR is already listening');
    return;
  }

  const config = vscode.workspace.getConfiguration('usir');
  const groqKey =
    (config.get('groqApiKey') as string) ?? process.env.GROQ_API_KEY ?? '';
  if (!groqKey) {
    vscode.window.showErrorMessage(
      'USIR: Configure `usir.groqApiKey` in settings first.',
    );
    return;
  }

  audioCapture = new WebviewAudioCapture({
    stt: whisperClient,
    language: 'en',
    prompt: 'developer voice commands for IDE',
    onUtterance: async (text) => {
      vscode.window.showInformationMessage(`USIR heard: "${text}"`);
      await handleInstruction(text);
    },
    onError: (err) => {
      vscode.window.showErrorMessage(`USIR audio error: ${err.message}`);
    },
  });

  try {
    await audioCapture.start();
    vscode.window.showInformationMessage(
      'USIR listening... (press Escape to stop)',
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('usir.cancelListening', () => {
        stopListening();
      }),
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `USIR: Could not access microphone. ${err}`,
    );
    audioCapture = null;
  }
}

function stopListening() {
  if (audioCapture) {
    audioCapture.stop();
    audioCapture = null;
    vscode.window.showInformationMessage('USIR stopped listening.');
  }
}

async function handleInstruction(rawInstruction: string) {
  // 1. Build FusedIntent
  const pointingTarget: PointingTarget | null = snapshotEngine.hot.pointerTarget
    ? {
        entityId: snapshotEngine.hot.pointerTarget.entityId,
        bounds: snapshotEngine.hot.pointerTarget.bounds,
        confidence: 1.0,
        dwellTimeMs: 0,
      }
    : null;
  const implicitSignals: ImplicitSignals = {
    cursorDwellTimeMs: 0,
    typingCadence: 'idle',
  };
  const fused = buildFusedIntent({
    linguisticInput: rawInstruction,
    pointingTarget,
    implicitSignals,
    sources: ['voice', 'mouse'],
  });

  // 2. Push to memory
  if (fused.pointingTarget) {
    interactionMemory.pushToHistory(fused.pointingTarget.entityId, {
      rawInput: rawInstruction,
    });
  }

  // 3. Route through LLM
  const snapshot = snapshotEngine.assemble(false);
  const plan = await llmRouter.route({
    rawInstruction,
    snapshot,
    memory: interactionMemory.snapshot(),
  });

  // 4. Handle ambiguities
  if (plan.ambiguities.length > 0) {
    await handleAmbiguities(plan);
    return;
  }

  // 5. Execute
  const result = await executor.execute(plan);
  if (!result.success) {
    vscode.window.showErrorMessage(
      `USIR plan failed: ${result.failedStepIds.join(', ')}`,
    );
    for (const step of result.stepResults) {
      if (!step.success) {
        vscode.window.showErrorMessage(
          `  Step ${step.stepId}: ${step.error}`,
        );
      }
    }
  } else {
    vscode.window.showInformationMessage(
      `USIR completed ${result.stepResults.length} steps in ${result.totalDurationMs}ms`,
    );
  }
}

async function handleAmbiguities(plan: { ambiguities: Array<{ field: string; candidates: string[] }> }) {
  const items: vscode.QuickPickItem[] = [];
  for (const amb of plan.ambiguities) {
    for (const c of amb.candidates) {
      items.push({
        label: c,
        description: `Resolves: ${amb.field}`,
      });
    }
  }

  if (items.length === 0) return;

  const picked = await vscode.window.showQuickPick(items, {
    title: 'USIR -- select the correct target',
    placeHolder: 'Which one did you mean?',
  });

  if (picked) {
    vscode.window.showInformationMessage(
      `USIR: selected "${picked.label}" for disambiguation`,
    );
  }
}

function showSnapshot() {
  const snapshot = snapshotEngine.assemble(true);
  const panel = vscode.window.createWebviewPanel(
    'usir-snapshot',
    'USIR Semantic Snapshot',
    vscode.ViewColumn.Two,
    { enableScripts: true },
  );

  const hotHtml = `<pre>${escapeHtml(JSON.stringify(snapshot.hot, null, 2))}</pre>`;
  const warmHtml = `<pre>${escapeHtml(JSON.stringify(snapshot.warm, null, 2))}</pre>`;
  const coldHtml = snapshot.cold
    ? `<pre>${escapeHtml(JSON.stringify(snapshot.cold, null, 2))}</pre>`
    : '<p><em>Cold snapshot not included</em></p>';

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>USIR Snapshot</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  h2 { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  pre { background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  .tier { margin-bottom: 24px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-hot { background: #e74c3c; color: #fff; }
  .badge-warm { background: #f39c12; color: #fff; }
  .badge-cold { background: #3498db; color: #fff; }
  .meta { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
</style>
</head>
<body>
  <h1>USIR Semantic Snapshot <span style="font-size:14px;font-weight:400;color:var(--vscode-descriptionForeground);">v${snapshot.version}</span></h1>
  <p class="meta">Source: ${snapshot.source} | Assembled: ${new Date(snapshot.assembledAt).toLocaleTimeString()}</p>
  <div class="tier">
    <h2><span class="badge badge-hot">HOT</span> Active Entity &amp; Cursor</h2>
    ${hotHtml}
  </div>
  <div class="tier">
    <h2><span class="badge badge-warm">WARM</span> Visible &amp; Recent</h2>
    ${warmHtml}
  </div>
  <div class="tier">
    <h2><span class="badge badge-cold">COLD</span> Workspace Graph</h2>
    ${coldHtml}
  </div>
</body>
</html>`;
}

function showProvenance() {
  const graph = provenanceStore.exportGraph();
  const panel = vscode.window.createWebviewPanel(
    'usir-provenance',
    'USIR Provenance',
    vscode.ViewColumn.Two,
    { enableScripts: true },
  );

  const nodes = Array.from(graph.nodes.values());
  const provenanceHtml = nodes.length > 0
    ? `<pre>${escapeHtml(JSON.stringify(nodes, null, 2))}</pre>`
    : '<p><em>No provenance records yet. Make an edit to see provenance.</em></p>';

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>USIR Provenance</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 16px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  h2 { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  pre { background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  .count { font-size: 14px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
</style>
</head>
<body>
  <h1>USIR Provenance History</h1>
  <p class="count">${nodes.length} provenance record${nodes.length !== 1 ? 's' : ''}</p>
  ${provenanceHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
