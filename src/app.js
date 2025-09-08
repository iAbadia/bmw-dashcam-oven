// BMW Dashcam Metadata Burner - Client-side
try { console.log('[app] app.js module executing'); } catch {}
// Pipeline (MVP):
// 1) Parse metadata.json -> array of entries.
// 2) Remux input .ts to .mp4 (copy) using ffmpeg.wasm for reliable playback.
// 3) Play the mp4 in a hidden <video>, draw to <canvas>, overlay metadata text per time.
// 4) Record the canvas stream with MediaRecorder to WebM and offer as download.

const logEl = document.getElementById('log');
const debugToggleEl = document.getElementById('debugToggle');
const clearLogBtn = document.getElementById('clearLogBtn');
const downloadLogBtn = document.getElementById('downloadLogBtn');
const metadataInput = document.getElementById('metadataFile');
const videoInput = document.getElementById('videoFiles');
const methodEl = document.getElementById('method');
const fontWrapEl = document.getElementById('fontWrap');
const fontFileEl = document.getElementById('fontFile');
const processBtn = document.getElementById('processBtn');
const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('canvas');
const downloadsEl = document.getElementById('downloads');
const overlayPositionEl = document.getElementById('overlayPosition');
const fontSizeEl = document.getElementById('fontSize');
const progressEl = document.getElementById('progress');
const progressTextEl = document.getElementById('progressText');
const previewSection = document.querySelector('section.preview');
const outputSection = document.querySelector('section.output');
const statusSection = document.querySelector('section.status');
let firstFrameDataURL = null;

// Inline progress in the Bake button
function setBakeProgress(pct) {
  try { processBtn?.style?.setProperty('--progress', `${Math.max(0, Math.min(1, pct)) * 100}%`); } catch {}
}
function setBaking(isBaking) {
  try {
    processBtn?.classList?.toggle('baking', !!isBaking);
    if (isBaking) {
      processBtn.classList.remove('complete');
      processBtn.textContent = 'Baking… 0%';
    } else {
      processBtn.textContent = 'Bake!';
    }
    processBtn?.setAttribute('aria-busy', isBaking ? 'true' : 'false');
  } catch {}
}
function setBakePercentLabel(pct) {
  try { processBtn.textContent = `Baking… ${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`; } catch {}
}
function setBakeComplete() {
  try {
    processBtn.classList.remove('baking');
    processBtn.classList.add('complete');
    processBtn.setAttribute('aria-busy', 'false');
    processBtn.textContent = 'Complete';
  } catch {}
}

function markProgressComplete() {
  try {
    if (progressEl) progressEl.value = 1;
    if (progressTextEl) progressTextEl.textContent = '100% · Complete';
  } catch {}
}

// Debug logging system
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let verbose = false;
const logBuffer = [];
function nowTs() { return new Date().toISOString(); }
function safeStringify(v) { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); } }
function pushLog(level, msg, data) {
  const entry = { t: nowTs(), level, msg: String(msg), data: data ?? null };
  logBuffer.push(entry);
  if (verbose || level !== 'debug') {
    const line = `[${entry.t}] ${level.toUpperCase()}: ${entry.msg}` + (entry.data ? `\n  ${safeStringify(entry.data)}` : '');
    const el = document.getElementById('log');
    if (el) {
      el.textContent += line + "\n";
      el.scrollTop = el.scrollHeight;
    } else {
      // Fallback to console if UI not yet ready
      try { console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](line); } catch { console.log(line); }
    }
  }
  window.__appLogs = logBuffer;
}
const debug = (m, d) => pushLog('debug', m, d);
const info = (m, d) => pushLog('info', m, d);
const warn = (m, d) => pushLog('warn', m, d);
const error = (m, d) => pushLog('error', m, d);

// UI controls for logs
try {
  const url = new URL(window.location.href);
  const qd = url.searchParams.get('debug');
  if (qd === '1' || qd === 'true') { if (debugToggleEl) debugToggleEl.checked = true; }
} catch {}
verbose = !!debugToggleEl?.checked;
debugToggleEl?.addEventListener('change', () => {
  verbose = !!debugToggleEl.checked;
  info(`Verbose logging ${verbose ? 'enabled' : 'disabled'}`);
});
clearLogBtn?.addEventListener('click', () => { try { const el = document.getElementById('log'); if (el) el.textContent = ''; } catch {} info('Logs cleared'); });
downloadLogBtn?.addEventListener('click', () => {
  const lines = logBuffer.map(e => `[${e.t}] ${e.level.toUpperCase()}: ${e.msg}` + (e.data ? `\n  ${safeStringify(e.data)}` : ''));
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bmw-dashcam-oven-log-${Date.now()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// Global error capture
window.addEventListener('error', (e) => error('window.error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }));
window.addEventListener('unhandledrejection', (e) => error('unhandledrejection', { reason: safeStringify(e.reason) }));

// Toggle FFmpeg font input visibility based on method
methodEl?.addEventListener('change', () => {
  const m = methodEl.value;
  if (fontWrapEl) fontWrapEl.classList.toggle('hidden', m !== 'ffmpeg-offline');
  updateButton();
});
fontFileEl?.addEventListener('change', () => updateButton());

// ffmpeg.wasm setup (self-hosted only)
let ffmpeg; // lazy-loaded

const loadFFmpeg = async () => {
  if (ffmpeg) return ffmpeg;
  const mod = window.FFmpegWASM;
  if (!mod || !mod.FFmpeg) {
    throw new Error('FFmpeg UMD not found. Ensure vendor/ffmpeg/ffmpeg.js is included via index.html.');
  }
  const corePathCfg = (typeof window.FFMPEG_CORE_URL === 'string' && window.FFMPEG_CORE_URL)
    ? window.FFMPEG_CORE_URL
    : 'vendor/ffmpeg/ffmpeg-core.js';
  const corePath = toAbsoluteURL(corePathCfg);
  info(`Loading ffmpeg core from: ${corePath}`);
  const inst = new mod.FFmpeg();
  try { inst.on?.('log', (r) => debug('[ffmpeg log]', r)); } catch {}
  try { inst.on?.('progress', (p) => debug('[ffmpeg progress]', p)); } catch {}
  const t0 = performance.now();
  try {
    await inst.load({ coreURL: corePath });
  } catch (e) {
    error('ffmpeg load failed', { message: e?.message || String(e) });
    throw e;
  }
  info(`ffmpeg loaded in ${(performance.now() - t0).toFixed(0)}ms`);
  ffmpeg = inst;
  return ffmpeg;
};

// Keep legacy log() calls as info()
function log(msg) { info(msg); }

let parsedMeta = null;
let selectedFiles = [];

async function handleMetadataChange() {
  logEl.textContent = '';
  parsedMeta = null;
  const file = metadataInput.files?.[0];
  if (!file) { updateButton(); return; }
  try {
    const txt = await file.text();
    const json = JSON.parse(txt);
    parsedMeta = normalizeMetadata(json);
    log(`Loaded metadata: ${parsedMeta.entries.length} entries for VIN ${parsedMeta.vin || 'N/A'}`);
  } catch (e) {
    log(`Failed to parse metadata: ${e.message}`);
  }
  updateButton();
}
metadataInput.addEventListener('change', handleMetadataChange);

function handleVideoChange() {
  selectedFiles = Array.from(videoInput.files || []);
  if (selectedFiles.length) {
    log(`Selected ${selectedFiles.length} video file(s)`);
    // Generate a static preview (first frame)
    try { showFirstFramePreview(selectedFiles[0]); } catch (e) { warn('Preview generation failed', { message: e?.message || String(e) }); }
  }
  updateButton();
}
videoInput.addEventListener('change', handleVideoChange);

function updateButton() {
  const hasMetaFile = !!(metadataInput?.files && metadataInput.files.length > 0);
  const canStart = hasMetaFile && selectedFiles.length > 0;
  processBtn.disabled = !canStart;
  debug('updateButton', { canStart, hasMeta: !!parsedMeta, hasMetaFile, files: selectedFiles.length });
}

// Initialize after DOM is fully ready
function init() {
  try { updateButton(); } catch (e) { console.error('updateButton failed', e); }
  try { const el = document.getElementById('log'); if (el) { el.textContent += '[app] init called\n'; el.scrollTop = el.scrollHeight; } } catch {}
  info('App ready');
  setBakeProgress(0);

  // Show Status section only when running locally (or if forced via ?status=1)
  try {
    const u = new URL(window.location.href);
    const forceStatus = u.searchParams.get('status') === '1';
    const disableStatus = u.searchParams.get('status') === '0';
    const h = window.location.hostname;
    const isLocal = (h === 'localhost' || h === '127.0.0.1' || h === '::1' || window.location.protocol === 'file:');
    const shouldShow = forceStatus || (isLocal && !disableStatus);
    statusSection?.classList?.toggle('hidden', !shouldShow);
  } catch {}
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

processBtn.addEventListener('click', async () => {
  try {
    processBtn.disabled = true;
    setBaking(true);
    setBakeProgress(0);
    downloadsEl.innerHTML = '';
    // MVP: process the first selected file. Can be extended to batch.
    const inputFile = selectedFiles[0];
    // Ensure metadata is parsed (enable button is now based on file presence)
    if (!parsedMeta) {
      info('Parsing metadata before processing...');
      await handleMetadataChange();
      if (!parsedMeta) throw new Error('Metadata could not be parsed.');
    }
    const method = 'realtime';
    info(`Advanced methods disabled. Using: ${method}`);
    let succeeded = false;
    try {
      await processRealtime(inputFile, parsedMeta);
      succeeded = true;
    } finally {
      if (succeeded) {
        setBakeProgress(1);
        setBakeComplete();
      }
    }
  } catch (e) {
    log(`Error: ${e.message}`);
  } finally {
    processBtn.disabled = false;
    // If not complete, reset UI back to idle state
    if (!processBtn.classList.contains('complete')) {
      setBaking(false);
      setBakeProgress(0);
    }
  }
});

function normalizeMetadata(json) {
  // Accept raw array with objects { VIN, entries } or just entries array.
  // Expected structure from sample: [ { VIN: string, entries: [ { id, date, time, velocity, latitude, longitude } ] } ]
  let vin = null;
  let entries = [];
  if (Array.isArray(json)) {
    // If array and first element has entries, take them.
    if (json[0] && Array.isArray(json[0].entries)) {
      vin = json[0].VIN || json[0].vin || null;
      entries = json[0].entries;
    } else {
      entries = json;
    }
  } else if (json && Array.isArray(json.entries)) {
    vin = json.VIN || json.vin || null;
    entries = json.entries;
  } else {
    throw new Error('Unrecognized metadata format. Expected {entries:[...]}.');
  }

  // Normalize and validate fields per entry
  const norm = entries.map((e, idx) => ({
    id: e.id ?? idx + 1,
    date: e.date || '',
    time: e.time || '',
    velocity: Number(e.velocity ?? 0),
    latitude: Number(e.latitude ?? 0),
    longitude: Number(e.longitude ?? 0),
  }));

  return { vin, entries: norm };
}

// ---- Method 1: Real-time Canvas + MediaRecorder ----
async function processRealtime(file, meta) {
  info(`\n=== Processing: ${file.name} ===`);
  // 1) Remux TS -> MP4 (copy codecs) for reliable playback in <video>
  const mp4Blob = await remuxTsToMp4(file);
  const mp4Url = URL.createObjectURL(mp4Blob);

  // 2) Prepare video, canvas, and recorder
  try { outputSection?.classList.add('hidden'); } catch {}
  try { previewSection?.classList.remove('hidden'); } catch {}
  videoEl.src = mp4Url;
  videoEl.muted = true;
  // Show live preview during processing but make it non‑interactive
  videoEl.classList.remove('hidden');
  canvasEl.classList.remove('hidden');
  videoEl.classList.add('noninteractive');
  videoEl.controls = false;
  // Always keep playback at normal speed to ensure 1x output timing with MediaRecorder
  videoEl.playbackRate = 1;
  // Init progress UI
  if (progressEl) progressEl.value = 0;
  if (progressTextEl) progressTextEl.textContent = 'Starting...';
  await once(videoEl, 'loadedmetadata');
  debug('video loadedmetadata', { width: videoEl.videoWidth, height: videoEl.videoHeight, duration: videoEl.duration });
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  const ctx = canvasEl.getContext('2d');

  const fps = getApproxFrameRate(videoEl) || 30;
  const stream = canvasEl.captureStream(fps);
  const mime = selectBestMimeType();
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const recDone = new Promise((resolve) => recorder.onstop = resolve);

  // 3) Draw loop using requestVideoFrameCallback if available, else fallback
  const pos = overlayPositionEl.value;
  const fontSize = parseInt(fontSizeEl.value, 10) || 24;
  const padding = 10;

  const totalEntries = meta.entries.length;
  // Assume entry 0 aligns to t=0, uniform spacing across duration
  const dt = videoEl.duration / Math.max(totalEntries, 1);

  info(`Video duration: ${videoEl.duration.toFixed(2)}s, fps≈${fps}, entries=${totalEntries}, dt≈${dt.toFixed(3)}s`);

  // Start recording and playback
  recorder.start(1000); // timeslice 1s
  videoEl.currentTime = 0;
  videoEl.addEventListener('playing', () => debug('video playing'));
  videoEl.addEventListener('pause', () => debug('video paused'));
  videoEl.addEventListener('ended', () => debug('video ended'));
  await videoEl.play();

  let stopped = false;
  const stopAll = () => {
    if (stopped) return;
    stopped = true;
    try { videoEl.pause(); } catch {}
    try { recorder.stop(); } catch {}
  };
  videoEl.addEventListener('ended', stopAll, { once: true });

  let lastWall = performance.now();
  let lastMedia = 0;
  const drawOverlay = (t) => {
    // Compute entry index based on current time t
    const i = Math.min(Math.floor(t / dt), totalEntries - 1);
    const entry = meta.entries[i] || meta.entries[meta.entries.length - 1];
    const lines = formatOverlayLines(entry);
    const lineHeight = Math.round(fontSize * 1.4);

    // Background box sizing
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const widths = lines.map((ln) => ctx.measureText(ln).width);
    const boxW = Math.max(...widths) + padding * 2;
    const boxH = lineHeight * lines.length + padding * 2;
    let x = padding, y = padding;
    if (pos.includes('right')) x = canvasEl.width - boxW - padding;
    if (pos.includes('bottom')) y = canvasEl.height - boxH - padding;

    // Draw video frame first
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

    // Capture first frame for poster (once)
    if (!firstFrameDataURL) {
      try { firstFrameDataURL = canvasEl.toDataURL('image/png'); } catch {}
    }

    // Draw box
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.globalAlpha = 1.0;

    // Draw text
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    lines.forEach((ln, idx) => {
      ctx.fillText(ln, x + padding, y + padding + idx * lineHeight);
    });

    // Update progress UI
    if (progressEl && progressTextEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      const pct = Math.min(1, Math.max(0, videoEl.currentTime / videoEl.duration));
      progressEl.value = pct;
      try { setBakeProgress(pct); setBakePercentLabel(pct); } catch {}
      const now = performance.now();
      const dMedia = Math.max(0, videoEl.currentTime - lastMedia);
      const dWall = Math.max(1, now - lastWall);
      const speed = dMedia / (dWall / 1000); // media seconds per real second
      const remaining = Math.max(0, videoEl.duration - videoEl.currentTime);
      const eta = speed > 0.01 ? remaining / speed : Infinity;
      progressTextEl.textContent = `${(pct*100).toFixed(1)}%${Number.isFinite(eta) ? ` · ETA ${eta.toFixed(1)}s` : ''}`;
      lastWall = now; lastMedia = videoEl.currentTime;
    }
  };

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const step = (now, metaData) => {
      drawOverlay(metaData.mediaTime);
      if (!stopped) videoEl.requestVideoFrameCallback(step);
    };
    videoEl.requestVideoFrameCallback(step);
  } else {
    // Fallback: timer-based draw loop
    let rafId;
    const loop = () => {
      drawOverlay(videoEl.currentTime);
      if (!stopped) rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  await recDone;
  markProgressComplete();
  try { setBakeProgress(1); } catch {}
  // Restore UI state for players
  try { videoEl.classList.remove('noninteractive'); videoEl.controls = true; } catch {}
  try { videoEl.classList.add('hidden'); canvasEl.classList.add('hidden'); } catch {}
  // Hide Preview section and show Output section
  try { previewSection?.classList.add('hidden'); } catch {}
  try { outputSection?.classList.remove('hidden'); } catch {}
  const outMime = recorder.mimeType && typeof recorder.mimeType === 'string' && recorder.mimeType.length
    ? recorder.mimeType
    : 'video/webm';
  const totalBytes = chunks.reduce((a, b) => a + (b?.size || 0), 0);
  info(`Recorder stopped. Chunks: ${chunks.length}, total ${formatBytes(totalBytes)}, mime=${outMime}`);
  const outBlob = new Blob(chunks, { type: outMime });
  const outUrl = URL.createObjectURL(outBlob);
  const a = document.createElement('a');
  a.href = outUrl;
  a.download = file.name.replace(/\.ts$/i, '') + '.webm';
  a.textContent = `Download ${a.download} (${formatBytes(outBlob.size)})`;
  downloadsEl.appendChild(a);
  info('Finished. Download ready.');

  // Show preview only after completion
  try {
    const preview = document.createElement('video');
    preview.controls = true; // allow user to interact with the finished output
    preview.playsInline = true;
    preview.preload = 'metadata';
    preview.muted = true; // allow programmatic seek/play if needed
    if (firstFrameDataURL) {
      try { preview.poster = firstFrameDataURL; } catch {}
    }
    // Prefer setting src directly for object URLs
    preview.src = outUrl;
    const type = outMime || 'video/webm';
    if (preview.canPlayType(type) === '') {
      warn(`Browser may not play preview type: ${type}`);
    }
    // Seek to show a frame
    preview.addEventListener('loadedmetadata', () => {
      try { preview.currentTime = 0.01; } catch {}
    }, { once: true });
    preview.addEventListener('seeked', () => {
      // Unmute after seek; user can press play
      try { preview.muted = false; } catch {}
    }, { once: true });
    preview.style.display = 'block';
    downloadsEl.appendChild(document.createElement('br'));
    downloadsEl.appendChild(preview);
  } catch {}
}

function formatOverlayLines(entry) {
  const { date, time, velocity, latitude, longitude } = entry;
  const speed = (Number.isFinite(velocity) ? velocity : 0).toFixed(1);
  const lat = (Number.isFinite(latitude) ? latitude : 0).toFixed(5);
  const lon = (Number.isFinite(longitude) ? longitude : 0).toFixed(5);
  return [
    `${date} ${time}`,
    `Speed: ${speed} km/h` ,
    `GPS: ${lat}, ${lon}`
  ];
}

async function remuxTsToMp4(file) {
  info('Loading ffmpeg.wasm...');
  const ff = await loadFFmpeg();
  const inName = 'input.ts';
  const outName = 'output.mp4';
  // Write input
  const arr = new Uint8Array(await file.arrayBuffer());
  debug('ffmpeg.writeFile', { name: inName, size: arr.length });
  await ff.writeFile(inName, arr);
  info('Remuxing TS to MP4 (stream copy)...');
  // -fflags +genpts to ensure proper PTS if missing; -c copy to avoid re-encoding
  const t0 = performance.now();
  await ff.exec(['-fflags', '+genpts', '-i', inName, '-c', 'copy', '-movflags', 'faststart', outName]);
  info(`ffmpeg exec finished in ${(performance.now() - t0).toFixed(0)}ms`);
  const data = await ff.readFile(outName);
  info(`Remuxed MP4 size: ${formatBytes(data.length)}`);
  return new Blob([data.buffer], { type: 'video/mp4' });
}

function once(target, event) {
  return new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
}

function formatBytes(bytes) {
  const units = ['B','KB','MB','GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function getApproxFrameRate(video) {
  // Try to infer fps based on readyState/timeupdate sampling if metadata not available
  // As a simple heuristic, return 30.
  return 30;
}

function selectBestMimeType() {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4', // usually not supported by MediaRecorder
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function toAbsoluteURL(p) {
  try {
    const u = new URL(p, window.location.href);
    return u.href;
  } catch (_) {
    return p;
  }
}

// Generate a static preview image by loading the first frame
async function showFirstFramePreview(file) {
  info('Generating preview...');
  // Hide output, show preview section
  try { outputSection?.classList.add('hidden'); } catch {}
  try { previewSection?.classList.remove('hidden'); } catch {}
  // Reset players
  videoEl.pause();
  videoEl.controls = false;
  videoEl.classList.remove('hidden');
  canvasEl.classList.remove('hidden');
  videoEl.classList.add('noninteractive');
  videoEl.muted = true;

  // Try direct TS first; if it fails to load metadata quickly, remux to MP4
  const tryLoad = async (url) => {
    return new Promise(async (resolve, reject) => {
      let done = false;
      const cleanup = () => {
        videoEl.onloadedmetadata = null;
        videoEl.onloadeddata = null;
        videoEl.onerror = null;
      };
      videoEl.onerror = () => { if (done) return; done = true; cleanup(); reject(new Error('video error')); };
      videoEl.onloadedmetadata = async () => {
        try { videoEl.currentTime = 0.01; } catch {}
      };
      videoEl.onloadeddata = () => { if (done) return; done = true; cleanup(); resolve(); };
      videoEl.src = url;
      try { await videoEl.load?.(); } catch {}
      // Timeout fallback
      setTimeout(() => { if (!done) { cleanup(); reject(new Error('preview timeout')); } }, 2000);
    });
  };

  let url = URL.createObjectURL(file);
  try {
    await tryLoad(url);
  } catch {
    // Remux to MP4 for better compatibility
    try { URL.revokeObjectURL(url); } catch {}
    const mp4Blob = await remuxTsToMp4(file);
    url = URL.createObjectURL(mp4Blob);
    await tryLoad(url);
  }

  // Draw the frame to canvas so it shows even if the <video> is paused/hidden later
  try {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
  } catch {}
  info('Preview ready');
}

// ---- Method 2: WebCodecs (experimental) ----
async function processWebCodecs(file, meta) {
  info(`\n=== Processing (WebCodecs): ${file.name} ===`);
  // Check support
  const hasWC = 'VideoEncoder' in window && 'VideoDecoder' in window && 'EncodedVideoChunk' in window;
  if (!hasWC) {
    warn('WebCodecs not supported in this browser. Falling back to real-time method.');
    return processRealtime(file, meta);
  }
  // This implementation requires an MP4 demuxer to feed EncodedVideoChunk to VideoDecoder.
  // Not bundled yet. We will fall back for now and keep the structure ready.
  warn('WebCodecs fast path requires a demuxer (e.g., mp4box.js). Not bundled. Falling back to real-time method.');
  return processRealtime(file, meta);
}

// ---- Method 3: FFmpeg.wasm offline (experimental) ----
async function processFfmpegOffline(file, meta) {
  info(`\n=== Processing (FFmpeg offline): ${file.name} ===`);
  const ff = await loadFFmpeg();
  info('Preparing files in FFmpeg FS...');
  const inTs = 'input.ts';
  const inMp4 = 'input.mp4';
  const outName = 'output.webm';
  const fontFile = fontFileEl?.files?.[0] || null;
  const fontName = fontFile ? 'font.ttf' : null;
  await ff.writeFile(inTs, new Uint8Array(await file.arrayBuffer()));
  if (fontFile && fontName) {
    await ff.writeFile(fontName, new Uint8Array(await fontFile.arrayBuffer()));
  }
  // First, remux TS to MP4 to avoid timestamp issues during re-encode
  await ff.exec(['-fflags', '+genpts', '-i', inTs, '-c', 'copy', '-movflags', 'faststart', inMp4]);
  
  // Determine duration for progress and ASS timings
  let durationSec = await probeDurationWithFFprobe(ff, inMp4);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    warn('ffprobe duration unavailable; progress bar may be approximate.');
    durationSec = null;
  }

  // Generate ASS subtitle file with per-sample overlay (date/time/speed/GPS)
  const overlayPos = overlayPositionEl?.value || 'bottom-left';
  const fontSize = parseInt(fontSizeEl?.value || '24', 10);
  const subsName = 'overlay.ass';
  const assText = buildAssFromMetadata(parsedMeta, durationSec, overlayPos, fontSize);
  await ff.writeFile(subsName, new TextEncoder().encode(assText));
  info('Running ffmpeg offline encode with timed subtitles overlay.');
  // Try multiple codec presets to improve compatibility/memory usage.
  const codecPlans = [
    ['libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '1'], // VP8 fast
    ['libvpx-vp9', '-b:v', '2M', '-cpu-used', '8', '-row-mt', '1', '-threads', '1'],     // VP9 fast
  ];
  let success = false, lastErr;
  const vfSub = fontName ? `subtitles=${subsName}:fontsdir=.` : `subtitles=${subsName}`;

  // Attach a temporary log listener to update progress
  const progressListener = (r) => {
    if (!r || !r.message) return;
    const secs = extractFfmpegTimeSeconds(r.message);
    if (secs != null && progressEl && progressTextEl) {
      if (durationSec && durationSec > 0) {
        const pct = Math.min(1, Math.max(0, secs / durationSec));
        progressEl.value = pct;
        progressTextEl.textContent = `${(pct*100).toFixed(1)}% · ${formatTime(secs)} / ${formatTime(durationSec)}`;
      } else {
        progressTextEl.textContent = `time ${formatTime(secs)}`;
      }
    }
  };
  try { ff.on?.('log', progressListener); } catch {}
  for (const plan of codecPlans) {
    const [codec, ...opts] = plan;
    try {
      info(`Trying codec: ${codec}`);
      await ff.exec([
        '-i', inMp4,
        '-vf', vfSub,
        '-pix_fmt', 'yuv420p',
        '-c:v', codec,
        ...opts,
        '-an', outName,
      ]);
      success = true;
      break;
    } catch (e) {
      lastErr = e;
      warn(`Codec ${codec} failed`, { message: e?.message || String(e) });
    }
  }
  try { ff.off?.('log', progressListener); } catch {}
  if (!success) {
    error('FFmpeg offline encode failed', { message: lastErr?.message || String(lastErr) });
    return;
  }
  markProgressComplete();
  const data = await ff.readFile(outName);
  const outBlob = new Blob([data.buffer], { type: 'video/webm' });
  const outUrl = URL.createObjectURL(outBlob);
  const a = document.createElement('a');
  a.href = outUrl;
  a.download = file.name.replace(/\.ts$/i, '') + '.webm';
  a.textContent = `Download ${a.download} (${formatBytes(outBlob.size)})`;
  downloadsEl.appendChild(a);
  info('Finished (FFmpeg offline). Download ready.');
}

function extractFfmpegTimeSeconds(line) {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  const h = parseInt(m[1],10)||0, mi=parseInt(m[2],10)||0, s=parseFloat(m[3])||0;
  return h*3600 + mi*60 + s;
}

async function probeDurationWithFFprobe(ff, fileName) {
  try {
    const res = await ff.ffprobe(['-i', fileName, '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0']);
    // res can be string or Uint8Array depending on implementation
    const txt = typeof res === 'string' ? res : new TextDecoder().decode(res);
    const val = parseFloat((txt || '').trim());
    if (Number.isFinite(val) && val > 0) return val;
  } catch {}
  return null;
}

function buildAssFromMetadata(meta, durationSec, overlayPos, fontSize) {
  const align = overlayPos === 'bottom-right' ? 9 : overlayPos === 'bottom-left' ? 8 : overlayPos === 'top-right' ? 3 : 4; // TL=4, TR=3, BL=8, BR=9
  const marginV = 16, marginH = 16;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Overlay, Arial, ${fontSize}, &H00FFFFFF, &H000000FF, &HAA000000, &H7F000000, 0, 0, 0, 0, 100, 100, 0, 0, 3, 1.2, 0, ${align}, ${marginH}, ${marginH}, ${marginV}, 0\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  // Determine spacing across duration
  const entries = meta?.entries || [];
  const n = entries.length;
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : n; // 1s per sample fallback
  const dt = n > 0 ? dur / n : 1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const e = entries[i];
    const t0 = i * dt;
    const t1 = Math.min(dur, (i + 1) * dt);
    const text = assEscapeSafe(`${e.date} ${e.time}\\N` + `Speed: ${Number(e.velocity||0).toFixed(1)} km/h\\N` + `GPS: ${Number(e.latitude||0).toFixed(5)}, ${Number(e.longitude||0).toFixed(5)}`);
    lines.push(`Dialogue: 0,${secToAss(t0)},${secToAss(t1)},Overlay,,0,0,0,,${text}`);
  }
  return header + lines.join('\n') + '\n';
}

/* Disabled: broken assEscape; use assEscapeSafe instead
function assEscape(s) {
  return String(s).replace(/[{}\\]/g, m => ({'{':'\u007B','}':'\u007D','\\':'\\\\'}[m])).replace(/\n/g, '\\N').replace(/
/g,'');
}
*/

function assEscapeSafe(s) {
  return String(s)
    .replace(/[{}\\]/g, (m) => ({ '{': '\\{', '}': '\\}', '\\': '\\\\' }[m]))
    .replace(/\n/g, '\\N')
    .replace(/\r/g, '');
}

function secToAss(sec) {
  const s = Math.max(0, sec);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const ss = (s%60).toFixed(2).padStart(5,'0');
  return `${String(h).padStart(1,'0')}:${String(m).padStart(2,'0')}:${ss}`;
}
function formatTime(s) {
  if (!Number.isFinite(s)) return '?:??';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
