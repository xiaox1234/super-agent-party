// Build entry for Anime4K WebGPU super-resolution bundle.
// The output static/libs/anime4k-sr.bundle.js is already committed.
// Currently uses CNNx2VL (best quality/speed balance for talking-head).
// To rebuild (e.g. after upgrading anime4k-webgpu):
//
//   npm install --no-save anime4k-webgpu esbuild
//   npx esbuild scripts/anime4k-entry.js --bundle --format=esm --target=es2020 --platform=browser --outfile=static/libs/anime4k-sr.bundle.js
//   npm uninstall anime4k-webgpu esbuild
//
export { CNNx2M, CNNx2VL, CNNx2UL } from 'anime4k-webgpu';
