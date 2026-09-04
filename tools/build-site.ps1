# Thin wrapper kept for muscle memory. The build now lives in tools/build.mjs (Node 18+).
#   Edit files under src/, run this (or `node tools/build.mjs`), commit index.html.
node (Join-Path $PSScriptRoot "build.mjs") @args
