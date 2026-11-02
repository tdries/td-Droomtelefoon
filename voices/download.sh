#!/bin/sh
# Optional: the Flemish/Dutch Piper voices for voice_server.py (~200 MB). Only needed for the "Piper" voice in the Droomtelefoon's
# voice picker; the game works without them (it then uses the browser's own voices).
# Licenses: nl_BE-nathalie CC0, nl_NL-mls CC-BY 4.0 (Multilingual LibriSpeech), nl_BE-rdh see its MODEL_CARD on Hugging Face.
set -e
cd "$(dirname "$0")" && mkdir -p piper
B=https://huggingface.co/rhasspy/piper-voices/resolve/main/nl
for v in nl_BE/nathalie/medium/nl_BE-nathalie-medium nl_BE/rdh/medium/nl_BE-rdh-medium nl_NL/mls/medium/nl_NL-mls-medium; do
  f=$(basename "$v")
  [ -f "piper/$f.onnx" ] || curl -fL --progress-bar -o "piper/$f.onnx" "$B/$v.onnx"
  [ -f "piper/$f.onnx.json" ] || curl -fsL -o "piper/$f.onnx.json" "$B/$v.onnx.json"
done
echo "Piper voices ready in voices/piper"
