Place the following files here to run without a CDN (recommended for GitHub Pages or offline use):

From npm packages:

@ffmpeg/ffmpeg (UMD build)
- dist/umd/ffmpeg.js -> vendor/ffmpeg/ffmpeg.js
 - dist/umd/814.ffmpeg.js -> vendor/ffmpeg/814.ffmpeg.js

@ffmpeg/core (UMD build)
- dist/umd/ffmpeg-core.js -> vendor/ffmpeg/ffmpeg-core.js
- dist/umd/ffmpeg-core.wasm -> vendor/ffmpeg/ffmpeg-core.wasm

After copying, index.html will load the local UMD, and src/app.js will prefer the local core first, then fall back to CDNs if missing.

Tip: Keep the core .js and .wasm in the same directory; ffmpeg-core.js expects the .wasm next to it.
