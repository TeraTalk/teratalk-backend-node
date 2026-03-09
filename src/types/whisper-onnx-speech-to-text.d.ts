declare module 'whisper-onnx-speech-to-text' {
  type TranscribeResult = { text: string; chunks?: unknown[] } | null | undefined;
  export function initWhisper(modelName?: string): Promise<{
    transcribe: (filePath: string, language?: string) => Promise<TranscribeResult | TranscribeResult[]>;
    disposeModel: () => Promise<void>;
  }>;
}
