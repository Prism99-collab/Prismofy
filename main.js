const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------
const PRISMOFY_DIR = path.join(os.homedir(), '.prismofy');
const YTDLP_PATH = path.join(PRISMOFY_DIR, 'yt-dlp.exe');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 520;
const CONFIG_FILE = path.join(PRISMOFY_DIR, 'Config', 'window.json');

let tray = null;
let win = null;
let currentDownload = null; // { child, cancelled }

// UI behaviour config (synced from renderer)
let uiPinned = false;
let uiRememberPos = true;
let savedBounds = null;

function loadBounds() {
  try { savedBounds = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) { savedBounds = null; }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(win.getBounds())); } catch (_) {}
}
function boundsVisible(b) {
  if (!b) return false;
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x + b.width > w.x + 20 && b.x < w.x + w.width - 20 &&
           b.y + 40 > w.y && b.y < w.y + w.height - 20;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDirs() {
  for (const d of [PRISMOFY_DIR,
    path.join(PRISMOFY_DIR, 'Downloads'),
    path.join(PRISMOFY_DIR, 'Cache'),
    path.join(PRISMOFY_DIR, 'Config')]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  }
}

function ytdlpExecutable() {
  return fs.existsSync(YTDLP_PATH) ? YTDLP_PATH : 'yt-dlp';
}

// Build --cookies-from-browser args so Instagram / private social media works.
function cookieArgs(browser) {
  if (browser && browser !== 'none') return ['--cookies-from-browser', browser];
  return [];
}

// Raw file URLs (images, pdfs, archives, direct media) that aren't site pages.
function isDirectFileURL(url) {
  return /\.(jpe?g|png|gif|webp|bmp|svg|mp4|webm|mov|mkv|avi|mp3|m4a|wav|flac|ogg|opus|pdf|zip|rar|7z|gif|apk|exe|txt|docx?|xlsx?|pptx?)(\?.*)?$/i.test(url);
}

function fileNameFromURL(url) {
  try {
    const u = new URL(url);
    let name = decodeURIComponent(path.basename(u.pathname)) || 'download';
    return name.replace(/[<>:"/\\|?*]/g, '_');
  } catch (_) { return 'download'; }
}

// Resize an image to an exact WxH using ffmpeg (scale to cover + center crop).
function resizeImage(file, w, h) {
  return new Promise((resolve) => {
    if (!fs.existsSync(file)) return resolve(false);
    const dir = path.dirname(file);
    let ext = path.extname(file).toLowerCase();
    if (!/\.(jpe?g|png|webp|bmp)$/.test(ext)) ext = '.jpg';
    const tmp = path.join(dir, `.prismofytmp_${Date.now()}${ext}`);
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
    const ff = spawn('ffmpeg', ['-y', '-i', file, '-vf', vf, tmp], { windowsHide: true });
    ff.on('error', () => resolve(false));
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) {
        try {
          const finalPath = path.join(dir, path.basename(file, path.extname(file)) + ext);
          if (finalPath !== file) { try { fs.unlinkSync(file); } catch (_) {} }
          fs.renameSync(tmp, finalPath);
          resolve(true);
        } catch (_) { try { fs.unlinkSync(tmp); } catch (__) {} resolve(false); }
      } else { try { fs.unlinkSync(tmp); } catch (_) {} resolve(false); }
    });
  });
}

// Resolve an ffmpeg location so post-processing works even if it's not on PATH.
function ffmpegInfo() {
  const candidates = [
    'ffmpeg', // PATH
    path.join(PRISMOFY_DIR, 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  // We only report availability; yt-dlp itself will resolve PATH.
  return candidates;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// yt-dlp download (first run setup)
// ---------------------------------------------------------------------------
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'Prismofy' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total && onProgress) onProgress(received / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// Location of the ffmpeg/ffprobe binaries bundled with the installer.
function bundledBinDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
}

// Copy the bundled ffmpeg/ffprobe next to yt-dlp on first run, so post-processing
// (audio extraction, Spotify→YouTube, video merge) works out of the box.
function ensureBundledFfmpeg() {
  const src = bundledBinDir();
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
    const from = path.join(src, name);
    const to = path.join(PRISMOFY_DIR, name);
    try {
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
    } catch (_) { /* non-fatal: yt-dlp will fall back to PATH */ }
  }
}

async function runSetup() {
  ensureDirs();
  ensureBundledFfmpeg();
  if (fs.existsSync(YTDLP_PATH)) {
    send('setup-state', { state: 'ready', text: 'Ready' });
    return;
  }
  send('setup-state', { state: 'installing', text: 'Installing fast backend (yt-dlp)…' });
  try {
    await downloadFile(YTDLP_URL, YTDLP_PATH, (p) => {
      send('setup-state', { state: 'installing', text: `Downloading yt-dlp… ${Math.round(p * 100)}%` });
    });
    send('setup-state', { state: 'ready', text: 'Ready' });
  } catch (err) {
    send('setup-state', { state: 'error', text: 'Installation failed. Check internet connection. (' + err.message + ')' });
  }
}

// ---------------------------------------------------------------------------
// ffmpeg availability check
// ---------------------------------------------------------------------------
function checkFfmpeg() {
  // Try each known ffmpeg location (PATH, ~/.prismofy, C:\ffmpeg) in turn so the
  // indicator matches what yt-dlp can actually use.
  const candidates = ffmpegInfo();
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) return send('ffmpeg-available', false);
    const exe = candidates[i++];
    try {
      const child = spawn(exe, ['-version'], { windowsHide: true });
      child.on('error', tryNext);
      child.on('close', (code) => (code === 0 ? send('ffmpeg-available', true) : tryNext()));
    } catch (_) {
      tryNext();
    }
  };
  tryNext();
}

// ---------------------------------------------------------------------------
// Spotify support
//
// Spotify audio is DRM-protected (Widevine) and cannot be downloaded directly.
// Instead we read the public track metadata (title + artist) from Spotify's
// embed page and download the matching song from YouTube via yt-dlp. No DRM is
// circumvented — Spotify's encrypted stream is never touched. (Same approach
// used by spotdl and similar tools.)
// ---------------------------------------------------------------------------
function isSpotifyURL(u) {
  return /^(https?:\/\/open\.spotify\.com\/|spotify:)/i.test(String(u).trim());
}

function parseSpotify(u) {
  u = String(u).trim();
  let m = u.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  m = u.match(/spotify:(track|album|playlist|episode|show):([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  return null;
}

// Simple HTTPS GET that follows redirects and returns the body as text.
function httpsGetText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpsGetText(next, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
  });
}

// Cache resolved Spotify metadata so a given link is only fetched once
// (fetch-info and start-download both resolve the same URLs).
const spotifyCache = new Map();

// Resolve a Spotify track/album/playlist URL into a list of { title, artist }.
async function spotifyTracks(url) {
  const meta = parseSpotify(url);
  if (!meta) return [];
  const cacheKey = `${meta.type}:${meta.id}`;
  if (spotifyCache.has(cacheKey)) return spotifyCache.get(cacheKey);
  if (meta.type === 'episode' || meta.type === 'show') {
    throw new Error('Spotify podcasts are not supported.');
  }
  const html = await httpsGetText(`https://open.spotify.com/embed/${meta.type}/${meta.id}`);
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Could not read Spotify metadata (page format changed).');
  let entity;
  try {
    entity = JSON.parse(m[1]).props.pageProps.state.data.entity;
  } catch (_) {
    throw new Error('Could not parse Spotify metadata.');
  }
  if (!entity) throw new Error('Could not read Spotify metadata.');

  const tracks = [];
  const pushTrack = (t) => {
    const title = t.title || t.name;
    let artist = t.subtitle || '';
    if (!artist && Array.isArray(t.artists)) artist = t.artists.map((a) => a.name).filter(Boolean).join(', ');
    if (title) tracks.push({ title, artist });
  };
  if (Array.isArray(entity.trackList) && entity.trackList.length) {
    entity.trackList.forEach(pushTrack);
  } else {
    pushTrack(entity);
  }
  if (!tracks.length) throw new Error('No tracks found in the Spotify link.');
  spotifyCache.set(cacheKey, tracks);
  return tracks;
}

// Replace any Spotify URLs in the list with `ytsearch1:` queries that yt-dlp
// can resolve to a matching YouTube source. Non-Spotify URLs pass through.
async function expandSpotifyUrls(urls) {
  const out = [];
  for (const u of urls) {
    if (isSpotifyURL(u)) {
      const tracks = await spotifyTracks(u);
      for (const t of tracks) {
        const q = (t.artist ? `${t.artist} - ${t.title}` : t.title).replace(/["\r\n]/g, ' ').trim();
        out.push(`ytsearch1:${q}`);
      }
    } else {
      out.push(u);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch video / playlist info
// ---------------------------------------------------------------------------
function parseEntry(info) {
  const title = info.title || 'Unknown';
  const url = info.webpage_url || info.url || '';
  let thumbnail = null;
  if (Array.isArray(info.thumbnails) && info.thumbnails.length) {
    thumbnail = info.thumbnails[info.thumbnails.length - 1].url;
  } else if (info.thumbnail) {
    thumbnail = info.thumbnail;
  }
  if (!thumbnail && info.id) {
    thumbnail = `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
  }
  return { url, title, thumbnailURL: thumbnail, duration: info.duration ?? null, isSelected: true };
}

ipcMain.handle('fetch-info', async (_evt, urls, cookies) => {
  // Spotify links → resolve metadata and search YouTube for a match.
  try {
    urls = await expandSpotifyUrls(urls);
  } catch (e) {
    return { error: 'Spotify: ' + e.message };
  }

  // Direct file URLs: skip yt-dlp, show a simple downloadable entry.
  const directFiles = urls.filter(isDirectFileURL);
  if (directFiles.length === urls.length && urls.length) {
    if (urls.length === 1) {
      return { isPlaylist: false, single: { title: fileNameFromURL(urls[0]), uploader: null, duration: null, thumbnail: isDirectFileURL(urls[0]) && /\.(jpe?g|png|gif|webp|bmp)$/i.test(urls[0]) ? urls[0] : null }, directFile: true };
    }
    return { isPlaylist: true, playlistTitle: `Batch (${urls.length} Files)`, directFile: true,
      entries: urls.map((u) => ({ url: u, title: fileNameFromURL(u), thumbnailURL: /\.(jpe?g|png|gif|webp|bmp)$/i.test(u) ? u : null, duration: null, isSelected: true })) };
  }

  return new Promise((resolve) => {
    const batchFile = path.join(PRISMOFY_DIR, 'batch.txt');
    try { fs.writeFileSync(batchFile, urls.join('\n'), 'utf8'); } catch (_) {}

    const args = ['--dump-single-json', '--flat-playlist', '--no-warnings', ...cookieArgs(cookies), '-a', batchFile];
    const child = spawn(ytdlpExecutable(), args, { windowsHide: true });

    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => resolve({ error: 'Could not run yt-dlp: ' + err.message }));
    child.on('close', (code) => {
      const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
      const entries = [];
      let playlistTitle = null;
      let firstSingle = null;
      for (const line of lines) {
        let info;
        try { info = JSON.parse(line); } catch (_) { continue; }
        if (Array.isArray(info.entries)) {
          if (!playlistTitle) playlistTitle = info.title || info.playlist_title || null;
          for (const e of info.entries) entries.push(parseEntry(e));
        } else {
          entries.push(parseEntry(info));
          if (!firstSingle) firstSingle = info;
        }
      }

      if (code !== 0 && entries.length === 0) {
        const errLine = out.split(/\r?\n/).find((l) => /error/i.test(l));
        const needsLogin = /login|rate-?limit|private|empty media|cookies|sign in|not available/i.test(out);
        const hint = needsLogin ? ' Try setting "Browser cookies" in Settings (log in to the site in that browser first).' : '';
        return resolve({ error: 'Could not fetch info. ' + (errLine || 'Unknown error') + hint });
      }
      if (entries.length === 0) return resolve({ error: 'No data received' });

      if (urls.length > 1 || entries.length > 1) {
        resolve({
          isPlaylist: true,
          playlistTitle: urls.length > 1 ? `Batch (${entries.length} Links)` : (playlistTitle || 'Playlist'),
          entries,
        });
      } else if (firstSingle) {
        let thumbnail = null;
        if (Array.isArray(firstSingle.thumbnails) && firstSingle.thumbnails.length) {
          thumbnail = firstSingle.thumbnails[firstSingle.thumbnails.length - 1].url;
        } else if (firstSingle.thumbnail) {
          thumbnail = firstSingle.thumbnail;
        }
        resolve({
          isPlaylist: false,
          single: {
            title: firstSingle.title || 'Unknown',
            uploader: firstSingle.uploader || null,
            duration: firstSingle.duration ?? null,
            thumbnail,
          },
        });
      } else if (entries.length === 1) {
        // Search results (e.g. a resolved Spotify track) arrive as a 1-item
        // playlist with no detailed "single" object — present the match as a single.
        const e0 = entries[0];
        resolve({
          isPlaylist: false,
          single: {
            title: e0.title || 'Unknown',
            uploader: null,
            duration: e0.duration ?? null,
            thumbnail: e0.thumbnailURL || null,
          },
        });
      } else {
        resolve({ error: 'No data received' });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Format specs (ported from YTDLPClient.swift)
// ---------------------------------------------------------------------------
const VIDEO_FORMATS = {
  best: { spec: 'bv*+ba/b', merge: true },
  best_mp4: { spec: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', merge: true },
  '1080p_mp4': { spec: 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]', merge: true },
  '720p_mp4': { spec: 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]', merge: true },
  '480p_mp4': { spec: 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=480]', merge: true },
  '360p_mp4': { spec: 'bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv*[height<=360]+ba/b[height<=360]', merge: true },
  worst: { spec: 'w', merge: false },
};
const AUDIO_FORMATS = {
  best_audio: { spec: 'ba/b', fmt: 'best', q: '0' },
  mp3_320: { spec: 'ba/b', fmt: 'mp3', q: '0' },
  mp3_128: { spec: 'ba/b', fmt: 'mp3', q: '5' },
  m4a_best: { spec: 'ba[ext=m4a]/ba/b', fmt: 'm4a', q: '0' },
  opus_best: { spec: 'ba[ext=webm]/ba/b', fmt: 'opus', q: '0' },
  flac: { spec: 'ba/b', fmt: 'flac', q: '0' },
  wav: { spec: 'ba/b', fmt: 'wav', q: '0' },
};

function findNextBatchFolder(base, prefix) {
  let i = 1;
  while (true) {
    const p = path.join(base, `${prefix}_${i}`);
    if (!fs.existsSync(p)) return p;
    i++;
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
ipcMain.handle('start-download', async (_evt, opts) => {
  const {
    urls, downloadType, videoFormatId, audioFormatId,
    downloadFolder, embedThumbnail, embedMetadata, writeSubtitles,
    isPlaylist, selectedUrls, isMultiple, cookies, imageRes,
  } = opts;

  let targetFolder = downloadFolder;
  let list = urls;

  if (isPlaylist && selectedUrls && selectedUrls.length) {
    list = selectedUrls;
    targetFolder = findNextBatchFolder(downloadFolder, 'Playlist');
    fs.mkdirSync(targetFolder, { recursive: true });
  } else if (isMultiple && urls.length > 1) {
    targetFolder = findNextBatchFolder(downloadFolder, 'Batch');
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  // Spotify links → resolve to YouTube search queries before downloading.
  try {
    list = await expandSpotifyUrls(list);
  } catch (e) {
    send('download-error', 'Spotify: ' + e.message);
    currentDownload = null;
    return { completed: false, folder: targetFolder };
  }

  const total = list.length;
  currentDownload = { cancelled: false, child: null };

  for (let index = 0; index < list.length; index++) {
    if (currentDownload.cancelled) break;
    const url = list[index];

    // Direct file URL → plain HTTP download (any source: images, pdfs, etc.)
    if (isDirectFileURL(url)) {
      const dest = path.join(targetFolder, fileNameFromURL(url));
      const ok = await downloadFile(url, dest, (p) => {
        send('download-progress', { percent: (index + p) / total, text: `${index + 1}/${total}: ${fileNameFromURL(url)} ${Math.round(p * 100)}%` });
      }).then(() => true).catch((e) => { send('download-error', 'Download failed: ' + e.message); return false; });
      if (!ok) { currentDownload = null; return { completed: false, folder: targetFolder }; }
      if (downloadType === 'image' && imageRes) {
        send('download-progress', { percent: (index + 1) / total, text: `${index + 1}/${total}: resizing to ${imageRes.w}×${imageRes.h}…` });
        await resizeImage(dest, imageRes.w, imageRes.h);
      }
      continue;
    }

    const args = ['--no-warnings', '--newline', '--progress', ...cookieArgs(cookies)];
    if (downloadType === 'video') {
      const f = VIDEO_FORMATS[videoFormatId] || VIDEO_FORMATS.best;
      args.push('-f', f.spec);
      if (f.merge) args.push('--merge-output-format', 'mp4');
      if (embedThumbnail) args.push('--embed-thumbnail');
      if (embedMetadata) args.push('--embed-metadata');
      if (writeSubtitles) args.push('--write-subs', '--embed-subs');
    } else if (downloadType === 'audio') {
      const a = AUDIO_FORMATS[audioFormatId] || AUDIO_FORMATS.best_audio;
      args.push('-f', a.spec, '-x', '--audio-format', a.fmt, '--audio-quality', a.q);
      if (embedThumbnail) args.push('--embed-thumbnail');
      if (embedMetadata) args.push('--embed-metadata');
    } else {
      // image: download the original picture at full resolution, no transcoding
      args.push('--no-playlist');
    }
    args.push('-o', '%(title)s [%(id)s].%(ext)s');
    args.push(url);

    const ok = await new Promise((resolve) => {
      const child = spawn(ytdlpExecutable(), args, { cwd: targetFolder, windowsHide: true });
      currentDownload.child = child;
      let errBuf = '';
      let destFile = null;

      const handleLine = (line) => {
        let dm;
        if ((dm = line.match(/Destination:\s*(.+)\s*$/))) destFile = dm[1].trim();
        else if ((dm = line.match(/\[download\]\s+(.+?) has already been downloaded/))) destFile = dm[1].trim();
        if (line.includes('[download]')) {
          const m = line.match(/(\d+\.?\d*)%/);
          if (m) {
            const pct = parseFloat(m[1]);
            const overall = (index + pct / 100) / total;
            send('download-progress', {
              percent: overall,
              text: `${index + 1}/${total}: ${line.replace('[download] ', '')}`,
            });
          }
        }
      };

      child.stdout.on('data', (d) => d.toString().split(/\r?\n/).forEach((l) => l && handleLine(l)));
      child.stderr.on('data', (d) => { errBuf += d.toString(); d.toString().split(/\r?\n/).forEach((l) => l && handleLine(l)); });
      child.on('error', () => { send('download-error', 'Failed to start download'); resolve(false); });
      child.on('close', async (code) => {
        if (currentDownload.cancelled) return resolve(false);
        if (code === 0) {
          if (downloadType === 'image' && imageRes && destFile) {
            const fp = path.isAbsolute(destFile) ? destFile : path.join(targetFolder, destFile);
            send('download-progress', { percent: (index + 1) / total, text: `${index + 1}/${total}: resizing to ${imageRes.w}×${imageRes.h}…` });
            await resizeImage(fp, imageRes.w, imageRes.h);
          }
          resolve(true);
        } else { send('download-error', 'Download failed: ' + errBuf.slice(0, 120)); resolve(false); }
      });
    });

    if (!ok) {
      currentDownload = null;
      return { completed: false, folder: targetFolder };
    }
  }

  const wasCancelled = currentDownload && currentDownload.cancelled;
  currentDownload = null;
  if (wasCancelled) return { completed: false, cancelled: true, folder: targetFolder };
  return { completed: true, folder: targetFolder };
});

ipcMain.handle('stop-download', () => {
  if (currentDownload) {
    currentDownload.cancelled = true;
    if (currentDownload.child) {
      try { currentDownload.child.kill('SIGKILL'); } catch (_) {}
    }
  }
  return true;
});

// ---------------------------------------------------------------------------
// Misc IPC
// ---------------------------------------------------------------------------
ipcMain.handle('choose-folder', async (_evt, current) => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current || os.homedir(),
  });
  if (!result.canceled && result.filePaths.length) return result.filePaths[0];
  return null;
});

ipcMain.handle('open-folder', (_evt, folder) => { shell.openPath(folder); });
ipcMain.handle('default-download-folder', () => path.join(os.homedir(), 'Downloads'));
ipcMain.on('quit-app', () => { app.quit(); });
ipcMain.on('hide-panel', () => { if (win) win.hide(); });
ipcMain.on('open-external', (_evt, url) => { shell.openExternal(url); });

ipcMain.on('ui-config', (_evt, cfg) => {
  if (cfg && typeof cfg.pinned === 'boolean') uiPinned = cfg.pinned;
  if (cfg && typeof cfg.rememberPos === 'boolean') uiRememberPos = cfg.rememberPos;
  if (win) win.setAlwaysOnTop(true, uiPinned ? 'pop-up-menu' : 'floating');
});

// Resize panel to fit content height requested by renderer (keeps top edge fixed).
ipcMain.on('set-height', (_evt, height) => {
  if (!win) return;
  const [w] = win.getSize();
  const bounds = win.getBounds();
  const topY = bounds.y;
  const newH = Math.round(Math.max(120, Math.min(700, height)));
  win.setBounds({ x: bounds.x, y: topY, width: w, height: newH });
});

// ---------------------------------------------------------------------------
// Window & tray
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('blur', () => {
    if (process.env.PRISMOFY_DEBUG_SHOW) return;
    if (uiPinned) return;
    if (win && !win.webContents.isDevToolsOpened()) win.hide();
  });
  win.on('moved', saveBounds);

  win.webContents.on('did-finish-load', () => {
    runSetup();
    checkFfmpeg();
    if (process.env.PRISMOFY_DEBUG_SHOW) {
      positionNearTray();
      win.show();
    }
  });
}

function positionNearTray() {
  if (!win) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const [w, h] = win.getSize();
  // Anchor to top-right of the work area (Windows tray is usually bottom-right,
  // but the panel reads best dropping from the top-right like the original).
  let x = wa.x + wa.width - w - 12;
  let y = wa.y + 12;
  win.setBounds({ x, y, width: w, height: h });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    if (uiRememberPos && boundsVisible(savedBounds)) {
      win.setBounds(savedBounds);
    } else {
      positionNearTray();
    }
    win.show();
    win.focus();
  }
}

function buildTrayIcon() {
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'tray.png');
  const jpgPath = path.join(__dirname, 'assets', 'prismofylogo.jpg');
  let img = nativeImage.createEmpty();
  for (const p of [icoPath, pngPath, jpgPath]) {
    if (fs.existsSync(p)) {
      img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) break;
    }
  }
  if (!img.isEmpty()) {
    img = img.resize({ width: 18, height: 18 });
  }
  return img;
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Prismofy — Just Download Anything');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Prismofy', click: () => { if (!win.isVisible()) toggleWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.on('click', () => toggleWindow());
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

app.whenReady().then(() => {
  ensureDirs();
  loadBounds();
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => { e.preventDefault(); }); // stay alive in tray
