/**
 * Whisper-based transcription for the voice agent.
 * Uses whisper-onnx-speech-to-text (ONNX runtime, works on Windows).
 * Converts uploaded audio to WAV 16 kHz via FFmpeg, then transcribes.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type TranscribeResult = { text: string; chunks?: Array<{ timestamp: [number, number]; text: string }> };

let cachedWhisper: Awaited<ReturnType<typeof import('whisper-onnx-speech-to-text')['initWhisper']>> | null = null;

async function getWhisper() {
  if (cachedWhisper) return cachedWhisper;
  // ESM package: must use native import() at runtime. Function() prevents tsc from emitting require().
  const load = new Function('return (s) => import(s)') as (s: string) => Promise<typeof import('whisper-onnx-speech-to-text')>;
  const mod = await load('whisper-onnx-speech-to-text');
  const initWhisper = mod.initWhisper;
  const modelName = process.env.WHISPER_MODEL || 'base.en';
  cachedWhisper = await initWhisper(modelName);
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
