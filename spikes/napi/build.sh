#!/bin/bash
# Builds the spike addon against the bridge dylib in native/. Run npm run build first.
set -euo pipefail
cd "$(dirname "$0")"
root="$(cd ../.. && pwd)"
node_include="$(dirname "$(dirname "$(readlink -f "$(command -v node)")")")/include/node"
mkdir -p build
# For the editor's clang (clangd and SourceKit-LSP read this). Gitignored: it
# holds this machine's paths.
printf '%s\n' -std=c11 "-I$node_include" \
  "-I$root/native/bridge/Sources/FoundationModelsCBindings/include" > compile_flags.txt
clang -std=c11 -O2 -Wall -Wextra -Werror -bundle -undefined dynamic_lookup \
  -I "$node_include" \
  -I "$root/native/bridge/Sources/FoundationModelsCBindings/include" \
  addon.c -L "$root/native" -lFoundationModels \
  -Wl,-rpath,"@loader_path/../../../native" \
  -o build/tsfm_napi.node
echo "built $(pwd)/build/tsfm_napi.node"
