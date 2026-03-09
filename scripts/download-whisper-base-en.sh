#!/bin/sh
# Non-interactive download of whisper base.en on Linux/Ubuntu.
# Run from backend root: bash scripts/download-whisper-base-en.sh
# Requires: curl or wget

set -e
BASE="https://huggingface.co/Xenova/whisper-base.en/resolve/main"
DIR="node_modules/whisper-onnx-speech-to-text/models/whisper-base.en"
mkdir -p "$DIR" "$DIR/onnx"

download() {
  local file="$1"
  local url="$BASE/$file"
  if [ -f "$DIR/$file" ]; then echo "[skip] $file"; return; fi
  if command -v curl >/dev/null 2>&1; then
    echo "[curl] $file"
    curl -sSL "$url" -o "$DIR/$file" --create-dirs
  elif command -v wget >/dev/null 2>&1; then
    echo "[wget] $file"
    wget -q --show-progress -O "$DIR/$file" "$url"
  else
    echo "Need curl or wget."; exit 1
  fi
}

for f in added_tokens.json config.json generation_config.json merges.txt normalizer.json \
         preprocessor_config.json quant_config.json special_tokens_map.json tokenizer.json \
         tokenizer_config.json vocab.json; do
  download "$f"
done
download "onnx/encoder_model.onnx"
download "onnx/decoder_model_merged.onnx"
echo "Done. base.en model ready."
