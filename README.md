# bmw-dashcam-oven

Live app: https://iabadia.github.io/bmw-dashcam-oven/

Burn your BMW dashcam metadata (date, time, speed, GPS) into the video — entirely in the browser, suitable for GitHub Pages hosting.

## How it works

- Client‑side only: Uses `ffmpeg.wasm` to remux `.ts` into `.mp4` for playback and the Canvas API + `MediaRecorder` to burn the overlay and export a WebM.
- No uploads: Files never leave your machine.
- Simple mapping: Assumes metadata samples span the full video uniformly (first entry at t=0, last near the end). Each frame’s overlay is picked by `currentTime`.

## Usage

1. Open `index.html` (or visit the repository’s GitHub Pages site if enabled).
2. Select your `Metadata.json` (as extracted by BMW dashcam).
3. Select one or more `.ts` files (MVP processes the first selected file).
4. Choose overlay options and press “Process Selected”.
5. After processing, click the download link for the resulting `.webm`.

Notes:
- The output is WebM (VP8/VP9), which plays in most modern browsers and players. If you need MP4/H.264 output, you can transcode locally with desktop ffmpeg.
- Processing speed depends on your CPU and video length; the recording runs near real time.
- The UI currently burns: `YYYY.MM.DD HH:MM:SS`, speed in km/h, latitude, longitude.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In the repository settings → Pages, set source to the `main` branch (root).
3. Wait for Pages to deploy, then open the published URL.

This repo includes a `.nojekyll` to serve assets as-is.

### Vendoring ffmpeg.wasm (no CDN)

For reliability and offline use, copy ffmpeg files into `vendor/ffmpeg/` as described in `vendor/ffmpeg/README.txt`. The app prefers local files and falls back to CDNs (`jsdelivr`, then `unpkg`).

## File structure

- `index.html` — main web app UI.
- `styles.css` — minimal styling.
- `src/app.js` — logic for metadata parsing, remuxing, canvas overlay, and recording.
- `EXAMPLE/` — sample input files (ignored in `.gitignore`).

## Roadmap / ideas

- Batch process multiple `.ts` files.
- Export MP4 directly with `ffmpeg.wasm` drawtext (heavier, but full offline render).
- Custom overlay templates and units (mph option).
- Infer exact sample rate from metadata if available.

## Privacy

All processing happens locally in your browser; no data is uploaded.

## License

See `LICENSE`.
