import * as vscode from 'vscode';
import type { STTProvider } from '@usir/audio-pipeline';

export interface WebviewAudioCaptureConfig {
  stt: STTProvider;
  language?: string;
  prompt?: string;
  onUtterance: (text: string) => void;
  onError?: (error: Error) => void;
}

export class WebviewAudioCapture {
  private config: WebviewAudioCaptureConfig;
  private panel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(config: WebviewAudioCaptureConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.panel) return;

    this.panel = vscode.window.createWebviewPanel(
      'usir-audio-capture',
      'USIR Audio',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(
      async (message: { type: string; [key: string]: unknown }) => {
        switch (message.type) {
          case 'pcm': {
            try {
              const uint8 = message.data as Uint8Array;
              const buffer = Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
              const text = await this.config.stt.transcribe(buffer, {
                language: this.config.language,
                prompt: this.config.prompt,
              });
              if (text.trim()) {
                this.config.onUtterance(text.trim());
              }
            } catch (err) {
              this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
            }
            break;
          }
          case 'error':
            this.config.onError?.(new Error(message.message as string));
            break;
        }
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(
      () => {
        this.panel = null;
      },
      undefined,
      this.disposables,
    );

    const readyDisposable = this.panel.webview.onDidReceiveMessage((msg: { type: string; status?: string }) => {
      if (msg.type === 'status' && msg.status === 'ready') {
        readyDisposable.dispose();
        this.panel?.webview.postMessage({ type: 'start' });
      }
    });

    this.disposables.push(readyDisposable);
  }

  stop(): void {
    if (this.panel) {
      this.panel.webview.postMessage({ type: 'stop' });
      this.panel.dispose();
      this.panel = null;
    }
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>USIR Audio Capture</title>
<style>
  html, body { background: transparent; margin: 0; padding: 0; overflow: hidden; }
</style>
</head>
<body>
<script>
(function() {
  const vscode = acquireVsCodeApi();

  const VAD_CONFIG = {
    energyThreshold: 0.01,
    silenceDurationMs: 700,
    minSpeechMs: 250
  };

  let audioContext = null;
  let mediaStream = null;
  let analyser = null;
  let animationId = null;
  let isCapturing = false;

  let vadState = 'idle';
  let speechStartAt = null;
  let lastSpeechAt = null;
  let audioBuffer = [];

  function computeRMS(samples) {
    var sum = 0;
    for (var i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  function floatTo16BitPCM(input) {
    var output = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  function processVAD(samples) {
    var now = Date.now();
    var rms = computeRMS(samples);
    var isSpeech = rms > VAD_CONFIG.energyThreshold;

    if (isSpeech) {
      if (vadState === 'idle' || vadState === 'silence') {
        vadState = 'listening';
        speechStartAt = now;
      }
      lastSpeechAt = now;
    } else if (vadState === 'listening' || vadState === 'speaking') {
      vadState = 'silence';
    }

    if (vadState === 'idle') return false;

    if (vadState === 'silence' && speechStartAt && lastSpeechAt) {
      var silenceDuration = now - lastSpeechAt;
      if (silenceDuration >= VAD_CONFIG.silenceDurationMs) {
        var speechDuration = lastSpeechAt - speechStartAt;
        if (speechDuration >= VAD_CONFIG.minSpeechMs) {
          vadState = 'idle';
          speechStartAt = null;
          lastSpeechAt = null;
          return true;
        }
        vadState = 'idle';
        speechStartAt = null;
        lastSpeechAt = null;
      }
    }

    return false;
  }

  function processAudio() {
    if (!isCapturing || !analyser) return;

    var buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    audioBuffer.push(new Float32Array(buffer));

    var utteranceEnd = processVAD(buffer);

    if (utteranceEnd) {
      var totalLength = 0;
      for (var j = 0; j < audioBuffer.length; j++) {
        totalLength += audioBuffer[j].length;
      }
      var concatenated = new Float32Array(totalLength);
      var offset = 0;
      for (var j = 0; j < audioBuffer.length; j++) {
        concatenated.set(audioBuffer[j], offset);
        offset += audioBuffer[j].length;
      }
      audioBuffer = [];

      var pcm = floatTo16BitPCM(concatenated);
      vscode.postMessage({
        type: 'pcm',
        data: new Uint8Array(pcm.buffer)
      });
    }

    animationId = requestAnimationFrame(processAudio);
  }

  function startCapture() {
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      }).then(function(stream) {
        mediaStream = stream;
        var source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        isCapturing = true;
        audioBuffer = [];
        vadState = 'idle';
        speechStartAt = null;
        lastSpeechAt = null;

        vscode.postMessage({ type: 'status', status: 'listening' });
        processAudio();
      }).catch(function(err) {
        vscode.postMessage({ type: 'error', message: err.message || String(err) });
      });
    } catch (err) {
      vscode.postMessage({ type: 'error', message: err.message || String(err) });
    }
  }

  function stopCapture() {
    isCapturing = false;
    audioBuffer = [];
    vadState = 'idle';
    speechStartAt = null;
    lastSpeechAt = null;

    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function(t) { t.stop(); });
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;

    vscode.postMessage({ type: 'status', status: 'stopped' });
  }

  window.addEventListener('message', function(event) {
    var message = event.data;
    switch (message.type) {
      case 'start':
        startCapture();
        break;
      case 'stop':
        stopCapture();
        break;
    }
  });

  vscode.postMessage({ type: 'status', status: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
