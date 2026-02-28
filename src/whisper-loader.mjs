/**
 * ESM loader for whisper-onnx-speech-to-text.
 * This is the only place that imports the package by name.
 * Works when loaded from CJS (default = function) or ESM (createWhisper or default).
 */
import { initWhisper } from 'whisper-onnx-speech-to-text';

export async function createWhisper(modelName) {
  return initWhisper(modelName);
}

export default createWhisper;
