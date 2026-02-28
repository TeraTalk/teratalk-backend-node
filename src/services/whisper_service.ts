/**
 * Whisper-based transcription for the voice agent.
 * Uses whisper-onnx-speech-to-text (ONNX runtime, works on Windows).
 * Converts uploaded audio to WAV 16 kHz via FFmpeg, then transcribes.
 * Loads the ESM package via whisper-loader.mjs so the model name is never passed to import().
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type TranscribeResult = { text: string; chunks?: Array<{ timestamp: [number, number]; text: string }> };

interface WhisperInstance {
  transcribe: (filePath: string, language?: string) => Promise<TranscribeResult | TranscribeResult[]>;
  disposeModel: () => Promise<void>;
}

let cachedWhisper: WhisperInstance | null = null;

async function getWhisper(): Promise<WhisperInstance> {
  if (cachedWhisper) return cachedWhisper;
  // Load ESM via path relative to this module. Prefer same dir as this file (src/ or dist/services/), then dist/.
  const loaderDir = typeof __dirname !== 'undefined' ? __dirname : path.join(process.cwd(), 'dist', 'services');
  const candidatePaths = [
    path.join(loaderDir, '..', 'whisper-loader.mjs'),
    path.join(process.cwd(), 'dist', 'whisper-loader.mjs'),
  ];
  let loaderPath: string | null = null;
  for (const p of candidatePaths) {
    try {
      await fs.access(p);
      loaderPath = p;
      break;
    } catch {
      continue;
    }
  }
  if (!loaderPath) {
    throw new Error(
      `whisper-loader.mjs not found. Tried: ${candidatePaths.join(', ')}. Run "npm run build" or ensure the file exists.`
    );
  }
  const loaderUrl = pathToFileURL(loaderPath).href;
  const load = (new Function('return (u) => import(u)')()) as (u: string) => Promise<unknown>;
  const loader = await load(loaderUrl);
  const createWhisper: (() => Promise<WhisperInstance>) | undefined =
    (typeof loader === 'function' ? loader as () => Promise<WhisperInstance> : undefined) ??
    (Reflect.get(loader as object, 'createWhisper') as (() => Promise<WhisperInstance>) | undefined) ??
    (typeof (loader as { default?: unknown })?.default === 'function' ? (loader as { default: () => Promise<WhisperInstance> }).default : undefined) ??
    ((loader as { default?: { createWhisper?: () => Promise<WhisperInstance> } }).default?.createWhisper);
  if (typeof createWhisper !== 'function') {
    const keys = typeof loader === 'object' && loader !== null ? Object.getOwnPropertyNames(loader) : [];
    throw new Error('whisper-loader.mjs: createWhisper not found. Keys: ' + keys.join(', '));
  }
  // Model name is set via process.env.WHISPER_MODEL and read inside the ESM loader only (never passed from CJS).
  cachedWhisper = await createWhisper();
  return cachedWhisper;
}

/**
 * Transcribe audio buffer (e.g. M4A from multer) to text using whisper-onnx-speech-to-text.
 * Converts to WAV 16 kHz via FFmpeg first.
 * Returns the full transcript string, or empty if nothing recognized.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<string> {
  const tmpDir = path.join(process.cwd(), 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });

  const id = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = extensionFromMime(mimeType, originalName);
  const inputPath = path.join(tmpDir, `${id}${ext}`);
  const wavPath = path.join(tmpDir, `${id}.wav`);

  try {
    await fs.writeFile(inputPath, audioBuffer);

    await convertToWav16k(inputPath, wavPath);

    const whisper = await getWhisper();
    if (!whisper) throw new Error('Whisper failed to initialize');
    const result = await whisper.transcribe(wavPath);
    if (result == null) return '';

    const text = Array.isArray(result)
      ? (result[0] as TranscribeResult | undefined)?.text ?? ''
      : (result as TranscribeResult)?.text ?? '';

    return (text || '').trim();
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(wavPath);
  }
}

function extensionFromMime(mime: string, name?: string): string {
  if (name) {
    const ext = path.extname(name).toLowerCase();
    if (ext && ['.m4a', '.mp4', '.aac', '.mp3', '.wav', '.webm', '.ogg', '.oga'].includes(ext)) {
      return ext;
    }
  }
  const map: Record<string, string> = {
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'application/ogg': '.ogg',
  };
  return map[mime] || '.m4a';
}

function convertToWav16k(inputPath: string, wavPath: string): Promise<void> {
  return execFileAsync('ffmpeg', [
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-y',
    wavPath,
  ]).then(() => undefined);
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}