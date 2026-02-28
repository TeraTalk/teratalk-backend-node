/**
 * ESM loader for whisper-onnx-speech-to-text.
 * This is the only place that imports the package by name.
 * Model name is read from process.env.WHISPER_MODEL here (never passed from CJS)
 * to avoid Node resolving the string "base.en" as a package when crossing CJS/ESM.
 */
import { initWhisper } from 'whisper-onnx-speech-to-text';

// Avoid a single literal that could be resolved as a package; build default from parts.
const DEFAULT_WHISPER_MODEL = ['base', 'en'].join('.');

export async function createWhisper() {
  const modelName = process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL;
  return initWhisper(modelName);
}

export default createWhisper;