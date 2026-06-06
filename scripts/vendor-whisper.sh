#!/usr/bin/env bash
#
# Build a static, self-contained whisper-cli and vendor it into resources/whisper/.
#
# Why we build from source instead of copying the Homebrew binary:
# Homebrew's whisper-cli is dynamically linked against separate libwhisper / libggml
# packages and dlopen()s its compute backends (BLAS, Metal) from the Cellar at run
# time. That makes it impossible to relocate to a machine without an identical
# Homebrew layout. A static build with the Metal shaders embedded depends only on
# system frameworks that ship with every macOS, so it is safe to drop inside the .app.
#
set -euo pipefail

# Pin to the same upstream version Homebrew ships so the model format matches.
WHISPER_VERSION="${WHISPER_VERSION:-v1.8.4}"
REPO_URL="https://github.com/ggml-org/whisper.cpp.git"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.whisper-build"
SRC_DIR="$BUILD_DIR/whisper.cpp-$WHISPER_VERSION"
OUT_DIR="$ROOT_DIR/resources/whisper"
OUT_BIN="$OUT_DIR/whisper-cli"

echo "==> Vendoring whisper-cli ($WHISPER_VERSION)"

# 1. Fetch the source at the pinned tag (shallow clone keeps it small).
if [ ! -d "$SRC_DIR/.git" ]; then
  rm -rf "$SRC_DIR"
  mkdir -p "$BUILD_DIR"
  git clone --depth 1 --branch "$WHISPER_VERSION" "$REPO_URL" "$SRC_DIR"
fi

# 2. Configure a static, portable, Metal-embedded build.
#    - BUILD_SHARED_LIBS=OFF  -> link libwhisper/libggml straight into the binary
#    - GGML_NATIVE=OFF        -> generic arm64, not tuned to this exact CPU (M1..M4)
#    - GGML_METAL_EMBED_LIBRARY=ON -> no external .metallib, no full-Xcode build dep
#    - GGML_BLAS/OPENMP=OFF   -> avoid pulling in Accelerate/libomp dylibs
cmake -S "$SRC_DIR" -B "$SRC_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_BLAS=OFF \
  -DGGML_OPENMP=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON

# 3. Build only the CLI target.
cmake --build "$SRC_DIR/build" --target whisper-cli --config Release -j"$(sysctl -n hw.ncpu)"

# 4. Copy the freshly built binary into the vendor directory.
BUILT_BIN="$SRC_DIR/build/bin/whisper-cli"
if [ ! -f "$BUILT_BIN" ]; then
  BUILT_BIN="$(find "$SRC_DIR/build" -name whisper-cli -type f | head -1)"
fi
if [ -z "${BUILT_BIN:-}" ] || [ ! -f "$BUILT_BIN" ]; then
  echo "ERROR: whisper-cli not found after build" >&2
  exit 1
fi
mkdir -p "$OUT_DIR"
cp "$BUILT_BIN" "$OUT_BIN"
chmod +x "$OUT_BIN"

# 5. Ad-hoc sign so Gatekeeper/AMFI lets the binary run on Apple Silicon.
codesign --force --sign - "$OUT_BIN"

# 6. Verify the binary depends only on system libraries. Bail loudly otherwise so
#    a bad build never ships hidden inside the .app.
echo "==> Linkage:"
otool -L "$OUT_BIN"
if otool -L "$OUT_BIN" | tail -n +2 | grep -E '/opt/homebrew|/usr/local|@rpath|@loader_path' >/dev/null; then
  echo "ERROR: vendored whisper-cli has non-system dynamic dependencies (see above)" >&2
  exit 1
fi

echo "==> OK: $OUT_BIN"
