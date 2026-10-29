#!/usr/bin/env bash
# Sets up the offline voice that reads each lesson aloud.
#
# Why this exists: the Claude app's page viewer has no built-in read-aloud
# voice (window.speechSynthesis is absent there), so a Listen button that
# asks the browser to speak does nothing. Each lesson therefore ships with a
# real audio file, made here, before the page is published.
#
# Everything comes from the npm and PyPI registries, because those are the
# hosts this sandbox can reach (Hugging Face and GitHub downloads are blocked):
#   - kokoro-q8-shards@1.0.0 : the Kokoro-82M speech model (Apache-2.0), in 6 parts
#   - kokoro-js@1.2.1        : carries the voice files (voices/*.bin)
#   - kokoro-onnx==0.6.1     : runs the model on the CPU (bundles its own espeak-ng)
#
# Usage:  bash legal-curriculum/tools/tts_setup.sh
# Prints the home folder to pass to make_audio.py. Safe to run twice: it skips
# what is already built. Set TTL_TTS_HOME to choose the folder.
set -euo pipefail
HOME_DIR="${TTL_TTS_HOME:-$HOME/.cache/ttl-tts}"
MODEL_SHA="fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478"
mkdir -p "$HOME_DIR/dl"
cd "$HOME_DIR"

if [ ! -f model.onnx ] || ! echo "$MODEL_SHA  model.onnx" | sha256sum -c --status; then
  (cd dl && npm pack --silent kokoro-q8-shards@1.0.0 >/dev/null)
  rm -rf dl/shards && mkdir -p dl/shards && tar -xzf dl/kokoro-q8-shards-1.0.0.tgz -C dl/shards
  cat dl/shards/package/kokoro-q8.part{0,1,2,3,4,5}.bin > model.onnx
  echo "$MODEL_SHA  model.onnx" | sha256sum -c --status || { echo "model checksum mismatch" >&2; exit 1; }
fi

if [ ! -f voices.npz ]; then
  (cd dl && npm pack --silent kokoro-js@1.2.1 >/dev/null)
  rm -rf dl/kj && mkdir -p dl/kj && tar -xzf dl/kokoro-js-1.2.1.tgz -C dl/kj
  NEED_VOICES=1
fi

if [ ! -x venv/bin/python ]; then
  python3 -m venv venv
  venv/bin/pip install -q --disable-pip-version-check kokoro-onnx==0.6.1 soundfile >/dev/null
fi

if [ "${NEED_VOICES:-0}" = 1 ]; then
  # Each voice file is a float32 array of 510 x 256 (one style row per text length).
  venv/bin/python -I -c '
import numpy as np, glob, os, sys
out = {}
for f in sorted(glob.glob(sys.argv[1] + "/*.bin")):
    n = os.path.basename(f)[:-4]
    if n[:1] in "ab":  # American and British English only
        out[n] = np.fromfile(f, dtype=np.float32).reshape(-1, 1, 256)
np.savez(sys.argv[2], **out)
' dl/kj/package/voices voices.npz
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
echo "$HOME_DIR"
