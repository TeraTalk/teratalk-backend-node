#!/usr/bin/env node
/**
 * Non-interactive download of whisper base.en model for whisper-onnx-speech-to-text.
 * Run from repo root: node scripts/download-whisper-base-en.js
 * Works on Windows and Linux (Ubuntu); no npx prompt.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const MODEL_ID = 'whisper-base.en';
const BASE_URL = `https://huggingface.co/Xenova/${MODEL_ID}/resolve/main`;
const REL_DIR = path.join('node_modules', 'whisper-onnx-speech-to-text', 'models', MODEL_ID);

const FILES = [
  'added_tokens.json',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'normalizer.json',
  'preprocessor_config.json',
  'quant_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged.onnx',
];

function get(url, redirectCount = 0) {
  const maxRedirects = 10;
  if (redirectCount > maxRedirects) {
    return Promise.reject(new Error('Too many redirects'));
  }
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers: { 'User-Agent': 'Node' } }, (res) => {
      const status = res.statusCode;
      if (status === 301 || status === 302 || status === 307 || status === 308) {
        const loc = res.headers.location;
        if (!loc) {
          reject(new Error(`${url} => ${status} without Location`));
          return;
        }
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return get(next, redirectCount + 1).then(resolve).catch(reject);
      }
      if (status !== 200) {
        reject(new Error(`${url} => ${status}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function main() {
  const root = process.cwd();
  const dir = path.join(root, REL_DIR);

  if (!fs.existsSync(path.join(root, 'node_modules', 'whisper-onnx-speech-to-text'))) {
    console.error('Run this from the backend root (teratalk-backend-node) after npm install.');
    process.exit(1);
  }

  console.log(`Downloading ${MODEL_ID} to ${REL_DIR}...`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });

  for (let i = 0; i < FILES.length; i++) {
    const file = FILES[i];
    const url = `${BASE_URL}/${file}`;
    const outPath = path.join(dir, file);
    if (fs.existsSync(outPath)) {
      console.log(`[${i + 1}/${FILES.length}] ${file} (cached)`);
      continue;
    }
    process.stdout.write(`[${i + 1}/${FILES.length}] ${file} ... `);
    try {
      const buf = await get(url);
      fs.writeFileSync(outPath, buf);
      console.log('ok');
    } catch (e) {
      console.log('FAIL');
      console.error(e.message);
      process.exit(1);
    }
  }

  console.log('Done. base.en model ready.');
}

main();
