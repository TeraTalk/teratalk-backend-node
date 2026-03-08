/**
 * Ensures audio is in a format accepted by the Phonological Detector API (WAV or MP3).
 * Converts M4A/AAC/other uploads to WAV using ffmpeg.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';

const WAV_MIMES = ['audio/wav', 'audio/wave', 'audio/x-wav'];
const MP3_MIME = 'audio/mpeg';

function isWavOrMp3(mimetype: string | undefined): boolean {
  if (!mimetype) return false;
  const m = mimetype.toLowerCase();
  return WAV_MIMES.some((w) => m === w) || m === MP3_MIME;
}

function getInputExtension(originalname: string | undefined, mimetype: string | undefined): string {
  if (originalname) {
    const ext = path.extname(originalname).toLowerCase();
    if (ext && ['.m4a', '.aac', '.mp4', '.wav', '.mp3'].includes(ext)) return ext;
  }
  if (mimetype) {
    const m = mimetype.toLowerCase();
    if (m.includes('mp3') || m === MP3_MIME) return '.mp3';
    if (m.includes('wav')) return '.wav';
    if (m.includes('aac')) return '.aac';
    if (m.includes('m4a') || m.includes('mp4') || m === 'audio/mp4') return '.m4a';
  }
  return '.m4a';
}

export interface TranscodeResult {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

/**
 * Returns audio as WAV or MP3 buffer. If input is already WAV or MP3, returns as-is.
 * Otherwise transcodes to WAV using ffmpeg (e.g. M4A/AAC from mobile recorders).
 */
export async function ensureWavOrMp3(
  buffer: Buffer,
  originalname?: string,
  mimetype?: string
): Promise<TranscodeResult> {
  if (isWavOrMp3(mimetype)) {
    const filename = originalname && /\.(wav|mp3)$/i.test(originalname) ? originalname : mimetype?.includes('mpeg') ? 'audio.mp3' : 'audio.wav';
    return { buffer, filename, mimetype: mimetype || 'audio/wav' };
  }

  const tmpDir = os.tmpdir();
  const id = randomBytes(8).toString('hex');
  const inputPath = path.join(tmpDir, `pd_in_${id}${getInputExtension(originalname, mimetype)}`);
  const outputPath = path.join(tmpDir, `pd_out_${id}.wav`);

  try {
    await fs.writeFile(inputPath, buffer);
    await runFfmpegToWav(inputPath, outputPath);
    const outBuffer = await fs.readFile(outputPath);
    return { buffer: outBuffer, filename: 'audio.wav', mimetype: 'audio/wav' };
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

let ffmpegPathSet = false;
function setFfmpegPathOnce(): void {
  if (ffmpegPathSet) return;
  try {
    const bin = require('ffmpeg-static') as string | undefined;
    if (bin && typeof bin === 'string') {
      ffmpeg.setFfmpegPath(bin);
      ffmpegPathSet = true;
    }
  } catch {
    // use system ffmpeg
  }
}

function runFfmpegToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    setFfmpegPathOnce();
    ffmpeg(inputPath)
      .outputOptions(['-acodec pcm_s16le', '-ar 16000', '-ac 1'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
