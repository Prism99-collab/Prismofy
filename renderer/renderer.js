// ---------------------------------------------------------------------------
// Format definitions (display names; specs live in main.js)
// ---------------------------------------------------------------------------
const VIDEO_FORMATS = [
  { id: 'best', name: 'Best Quality' },
  { id: 'best_mp4', name: 'Best (MP4)' },
  { id: '1080p_mp4', name: '1080p (MP4)' },
  { id: '720p_mp4', name: '720p (MP4)' },
  { id: '480p_mp4', name: '480p (MP4)' },
  { id: '360p_mp4', name: '360p (MP4)' },
  { id: 'worst', name: 'Worst Quality' },
];
const AUDIO_FORMATS = [
  { id: 'best_audio', name: 'Best Audio' },
  { id: 'mp3_320', name: 'MP3 (320k)' },
  { id: 'mp3_128', name: 'MP3 (128k)' },
  { id: 'm4a_best', name: 'M4A (AAC)' },
  { id: 'opus_best', name: 'OPUS' },
  { id: 'flac', name: 'FLAC' },
  { id: 'wav', name: 'WAV' },
];
// Image resolution presets. res:null => keep original. w/h => cover + center-crop.
const IMAGE_FORMATS = [
  { id: 'original', name: 'Original quality', res: null },
  { id: 'pc_1080p', name: '1920×1080 · PC / Desktop (16:9)', res: { w: 1920, h: 1080 } },
  { id: 'pc_1440p', name: '2560×1440 · PC QHD (16:9)', res: { w: 2560, h: 1440 } },
  { id: 'pc_4k', name: '3840×2160 · PC 4K (16:9)', res: { w: 3840, h: 2160 } },
  { id: 'pc_720p', name: '1280×720 · HD (16:9)', res: { w: 1280, h: 720 } },
  { id: 'story', name: '1080×1920 · Story / Reel (9:16)', res: { w: 1080, h: 1920 } },
  { id: 'portrait', name: '1080×1350 · Portrait post (4:5)', res: { w: 1080, h: 1350 } },
  { id: 'square', name: '1080×1080 · Square post (1:1)', res: { w: 1080, h: 1080 } },
  { id: 'phone_ios', name: '1170×2532 · Phone wallpaper (iPhone)', res: { w: 1170, h: 2532 } },
  { id: 'phone_android', name: '1440×3200 · Phone wallpaper (Android)', res: { w: 1440, h: 3200 } },
];

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------
const store = {
  get(key, def) {
    const v = localStorage.getItem(key);
    if (v === null) return def;
    try { return JSON.parse(v); } catch (_) { return v; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

const state = {
  theme: store.get('theme', 'rareJade'),
  isMultiple: store.get('isMultiple', false),
  downloadType: store.get('downloadType', 'video'),
  videoFormatId: store.get('videoFormatId', 'best'),
  audioFormatId: store.get('audioFormatId', 'best_audio'),
  imageFormatId: store.get('imageFormatId', 'original'),
  videoOrder: store.get('videoOrder', VIDEO_FORMATS.map((f) => f.id)),
  audioOrder: store.get('audioOrder', AUDIO_FORMATS.map((f) => f.id)),
  downloadFolder: store.get('downloadFolder', null),
  embedThumbnail: store.get('embedThumbnail', true),
  embedMetadata: store.get('embedMetadata', true),
  writeSubtitles: store.get('writeSubtitles', false),
  cookies: store.get('cookies', 'none'),
  pinned: store.get('pinned', false),
  rememberPos: store.get('rememberPos', true),
  customAccent: store.get('customAccent', null),
  // runtime
  setupReady: false,
  isFetching: false,
  isPlaylist: false,
  playlistTitle: '',
  entries: [],
  single: null,
  infoError: null,
  isDownloading: false,
  downloadCompleted: false,
  downloadError: null,
  ffmpeg: true,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = ['setup', 'main', 'settings', 'priority', 'about'];
let view = 'main';

function showScreen(name) {
  view = name;
  for (const s of screens) $(s).classList.toggle('hidden', s !== name);
  // bottom bar visible only when setup is done
  $('bottom-bar').classList.toggle('hidden', !state.setupReady || name === 'setup');
  const backBtn = $('bb-back');
  backBtn.innerHTML = (name === 'settings' || name === 'priority' || name === 'about') ? '&#8592;' : '&#9881;';
  syncHeight();
}

function syncHeight() {
  // measure content and ask main to resize
  requestAnimationFrame(() => {
    const h = document.querySelector('.app').scrollHeight;
    window.prismofy.setHeight(h + 2);
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function fmtDuration(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
               : `${m}:${String(s).padStart(2, '0')}`;
}

function extractURLs() {
  const text = state.isMultiple ? $('url-textarea').value : $('url-input').value;
  if (state.isMultiple) {
    return text.split(/\r?\n/).map((l) => l.trim())
      .filter((l) => l.startsWith('http://') || l.startsWith('https://'));
  }
  const t = text.trim();
  return (t.startsWith('http://') || t.startsWith('https://')) ? [t] : [];
}

function hasValidURL() { return extractURLs().length > 0; }

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// ---------------------------------------------------------------------------
// Rendering: format dropdowns
// ---------------------------------------------------------------------------
function renderFormatDropdowns() {
  const vSel = $('video-format'), aSel = $('audio-format');
  vSel.innerHTML = '';
  state.videoOrder.forEach((id) => {
    const f = VIDEO_FORMATS.find((x) => x.id === id); if (!f) return;
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; vSel.appendChild(o);
  });
  aSel.innerHTML = '';
  state.audioOrder.forEach((id) => {
    const f = AUDIO_FORMATS.find((x) => x.id === id); if (!f) return;
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; aSel.appendChild(o);
  });
  const iSel = $('image-format');
  iSel.innerHTML = '';
  IMAGE_FORMATS.forEach((f) => {
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; iSel.appendChild(o);
  });
  vSel.value = state.videoFormatId;
  aSel.value = state.audioFormatId;
  iSel.value = state.imageFormatId;
}

// ---------------------------------------------------------------------------
// Rendering: info area
// ---------------------------------------------------------------------------
function thumbHTML(url, w, h, cls) {
  if (url) return `<img class="thumb ${cls}" src="${esc(url)}" style="width:${w}px;height:${h}px" referrerpolicy="no-referrer" />`;
  return `<div class="thumb ${cls}" style="width:${w}px;height:${h}px">&#128247;</div>`;
}

function renderInfo() {
  const el = $('info-area');
  if (state.isFetching) {
    el.innerHTML = `<div class="fetching"><div class="spinner"></div>Fetching info…</div>`;
  } else if (state.isPlaylist && state.entries.length) {
    const sel = state.entries.filter((e) => e.isSelected).length;
    const tot = state.entries.length;
    const allSel = sel === tot;
    const rows = state.entries.map((e, i) => `
      <div class="pl-row">
        <input type="checkbox" data-i="${i}" ${e.isSelected ? 'checked' : ''} />
        ${thumbHTML(e.thumbnailURL, 56, 32, 'pl-thumb')}
        <div class="pl-meta">
          <div class="pl-title">${esc(e.title)}</div>
          ${e.duration != null ? `<div class="pl-dur mono">${fmtDuration(e.duration)}</div>` : ''}
        </div>
      </div>`).join('');
    el.innerHTML = `
      <div class="playlist-head">
        <span class="p-title">${esc(state.playlistTitle)}</span>
        <button class="link-btn" id="select-all">${allSel ? 'Deselect All' : 'Select All'}</button>
        <span class="mono" style="font-size:9px;color:var(--secondary)">${sel}/${tot}</span>
      </div>
      <div class="playlist-list">${rows}</div>`;
    $('select-all').onclick = () => {
      const all = state.entries.every((e) => e.isSelected);
      state.entries.forEach((e) => { e.isSelected = !all; });
      renderInfo(); updateDownloadButton();
    };
    el.querySelectorAll('.pl-row input').forEach((cb) => {
      cb.onchange = () => {
        state.entries[+cb.dataset.i].isSelected = cb.checked;
        renderInfo(); updateDownloadButton();
      };
    });
  } else if (state.single) {
    const s = state.single;
    el.innerHTML = `
      <div class="single-video">
        ${thumbHTML(s.thumbnail, 110, 62, '')}
        <div class="meta">
          <div class="v-title">${esc(s.title)}</div>
          ${s.uploader ? `<div class="v-sub">${esc(s.uploader)}</div>` : ''}
          ${s.duration != null ? `<div class="v-sub mono">${fmtDuration(s.duration)}</div>` : ''}
        </div>
      </div>`;
  } else {
    el.innerHTML = '';
  }
  syncHeight();
}

// ---------------------------------------------------------------------------
// Info error / download messages
// ---------------------------------------------------------------------------
function renderMessages() {
  const ie = $('info-error');
  ie.classList.toggle('hidden', !state.infoError);
  if (state.infoError) ie.innerHTML = `&#9888; ${esc(state.infoError)}`;

  const dc = $('dl-complete');
  dc.classList.toggle('hidden', !state.downloadCompleted);
  if (state.downloadCompleted) dc.innerHTML = `&#10003; Saved to ${esc(state.downloadFolder)}`;

  const de = $('dl-error');
  de.classList.toggle('hidden', !state.downloadError);
  if (state.downloadError) de.innerHTML = `&#10005; ${esc(state.downloadError)}`;
}

// ---------------------------------------------------------------------------
// Download button / progress
// ---------------------------------------------------------------------------
function updateDownloadButton() {
  const btn = $('download-btn');
  btn.disabled = !hasValidURL() || state.isDownloading;
  $('dl-progress').classList.toggle('hidden', !state.isDownloading);
  btn.classList.toggle('hidden', state.isDownloading);
}

// ---------------------------------------------------------------------------
// Clear info state
// ---------------------------------------------------------------------------
function clearState() {
  state.isPlaylist = false; state.entries = []; state.single = null;
  state.infoError = null; state.downloadError = null; state.downloadCompleted = false;
  state.isFetching = false;
  renderInfo(); renderMessages(); updateDownloadButton();
}

// ---------------------------------------------------------------------------
// Fetch info (debounced)
// ---------------------------------------------------------------------------
let fetchTimer = null;
function debouncedFetch() {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(() => { if (hasValidURL()) doFetch(); }, 800);
}

async function doFetch() {
  const urls = extractURLs();
  if (!urls.length) return;
  state.isFetching = true; state.isPlaylist = false; state.entries = [];
  state.single = null; state.infoError = null; state.downloadCompleted = false; state.downloadError = null;
  renderInfo(); renderMessages();

  const res = await window.prismofy.fetchInfo(urls, state.cookies);
  state.isFetching = false;
  if (res.error) {
    state.infoError = res.error;
  } else if (res.isPlaylist) {
    state.isPlaylist = true; state.playlistTitle = res.playlistTitle; state.entries = res.entries;
  } else if (res.single) {
    state.single = res.single;
  }
  renderInfo(); renderMessages(); updateDownloadButton();
}

// ---------------------------------------------------------------------------
// Start / stop download
// ---------------------------------------------------------------------------
async function startDownload() {
  const urls = extractURLs();
  if (!urls.length) return;
  state.isDownloading = true; state.downloadCompleted = false; state.downloadError = null;
  $('bar-fill').style.width = '0%'; $('progress-pct').textContent = '0%';
  $('progress-text').textContent = 'Starting…';
  renderMessages(); updateDownloadButton();

  let selectedUrls = null;
  if (state.isPlaylist && state.entries.length) {
    selectedUrls = state.entries.filter((e) => e.isSelected).map((e) => e.url);
    if (!selectedUrls.length) {
      state.isDownloading = false; state.downloadError = 'No videos selected';
      renderMessages(); updateDownloadButton(); return;
    }
  }

  const res = await window.prismofy.startDownload({
    urls, downloadType: state.downloadType,
    videoFormatId: state.videoFormatId, audioFormatId: state.audioFormatId,
    downloadFolder: state.downloadFolder,
    embedThumbnail: state.embedThumbnail, embedMetadata: state.embedMetadata,
    writeSubtitles: state.writeSubtitles,
    isPlaylist: state.isPlaylist, selectedUrls, isMultiple: state.isMultiple,
    cookies: state.cookies,
    imageRes: (IMAGE_FORMATS.find((f) => f.id === state.imageFormatId) || {}).res || null,
  });

  state.isDownloading = false;
  if (res.completed) {
    state.downloadCompleted = true;
    state.downloadFolder = res.folder;
    $('bar-fill').style.width = '100%'; $('progress-pct').textContent = '100%';
    $('progress-text').textContent = 'Complete';
  }
  renderMessages(); updateDownloadButton();
}

async function stopDownload() {
  await window.prismofy.stopDownload();
  state.isDownloading = false;
  $('progress-text').textContent = 'Stopped';
  updateDownloadButton();
}

// ---------------------------------------------------------------------------
// Priority lists (drag to reorder)
// ---------------------------------------------------------------------------
function renderPriority() {
  buildSortable($('video-priority'), state.videoOrder, VIDEO_FORMATS, (order) => {
    state.videoOrder = order; store.set('videoOrder', order); renderFormatDropdowns();
  });
  buildSortable($('audio-priority'), state.audioOrder, AUDIO_FORMATS, (order) => {
    state.audioOrder = order; store.set('audioOrder', order); renderFormatDropdowns();
  });
}

function buildSortable(ul, order, defs, onChange) {
  ul.innerHTML = '';
  order.forEach((id) => {
    const f = defs.find((x) => x.id === id); if (!f) return;
    const li = document.createElement('li');
    li.draggable = true; li.dataset.id = id;
    li.innerHTML = `<span>${esc(f.name)}</span><span class="grip">&#9776;</span>`;
    ul.appendChild(li);
  });
  let dragged = null;
  ul.querySelectorAll('li').forEach((li) => {
    li.addEventListener('dragstart', () => { dragged = li; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging'); dragged = null;
      onChange([...ul.querySelectorAll('li')].map((x) => x.dataset.id));
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragged || dragged === li) return;
      const rect = li.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      ul.insertBefore(dragged, after ? li.nextSibling : li);
    });
  });
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(t) {
  state.theme = t; store.set('theme', t);
  document.body.dataset.theme = t;
  const sel = $('theme-select'); if (sel) sel.value = t;
  document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.theme === t));
  applyAccent();
}

function applyAccent() {
  if (state.customAccent) document.body.style.setProperty('--accent', state.customAccent);
  else document.body.style.removeProperty('--accent');
  const inp = $('accent-color');
  if (inp) inp.value = state.customAccent || getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#40a68c';
}

function pushUIConfig() {
  window.prismofy.uiConfig({ pinned: state.pinned, rememberPos: state.rememberPos });
}

// ---------------------------------------------------------------------------
// Wire up events
// ---------------------------------------------------------------------------
function init() {
  applyTheme(state.theme);
  renderFormatDropdowns();
  renderPriority();

  // download folder default
  (async () => {
    if (!state.downloadFolder) {
      state.downloadFolder = await window.prismofy.defaultDownloadFolder();
      store.set('downloadFolder', state.downloadFolder);
    }
    $('folder-path').textContent = state.downloadFolder;
  })();

  // multiple toggle
  $('multi-toggle').checked = state.isMultiple;
  $('url-single').classList.toggle('hidden', state.isMultiple);
  $('url-multi').classList.toggle('hidden', !state.isMultiple);
  $('multi-toggle').onchange = (e) => {
    state.isMultiple = e.target.checked; store.set('isMultiple', state.isMultiple);
    $('url-single').classList.toggle('hidden', state.isMultiple);
    $('url-multi').classList.toggle('hidden', !state.isMultiple);
    clearState(); syncHeight();
  };

  // URL inputs
  const onInput = (val) => {
    $('url-clear').classList.toggle('hidden', !val);
    const t = val.trim();
    if (!t) { clearState(); return; }
    if (t.startsWith('http://') || t.startsWith('https://')) {
      updateDownloadButton(); debouncedFetch();
    } else { updateDownloadButton(); }
  };
  $('url-input').addEventListener('input', (e) => onInput(e.target.value));
  $('url-textarea').addEventListener('input', (e) => onInput(e.target.value));
  $('url-clear').onclick = () => { $('url-input').value = ''; onInput(''); };
  $('multi-collapse').onclick = () => $('url-multi').classList.toggle('collapsed');

  // type segmented
  document.querySelectorAll('.seg').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.downloadType = b.dataset.type; store.set('downloadType', state.downloadType);
      $('video-format').classList.toggle('hidden', state.downloadType !== 'video');
      $('audio-format').classList.toggle('hidden', state.downloadType !== 'audio');
      $('image-format').classList.toggle('hidden', state.downloadType !== 'image');
    };
    if (b.dataset.type === state.downloadType) b.click();
  });

  // format dropdowns
  $('video-format').onchange = (e) => { state.videoFormatId = e.target.value; store.set('videoFormatId', state.videoFormatId); };
  $('audio-format').onchange = (e) => { state.audioFormatId = e.target.value; store.set('audioFormatId', state.audioFormatId); };
  $('image-format').onchange = (e) => { state.imageFormatId = e.target.value; store.set('imageFormatId', state.imageFormatId); };

  // download / stop
  $('download-btn').onclick = startDownload;
  $('stop-btn').onclick = stopDownload;

  // settings checkboxes
  $('opt-thumb').checked = state.embedThumbnail;
  $('opt-meta').checked = state.embedMetadata;
  $('opt-subs').checked = state.writeSubtitles;
  $('opt-thumb').onchange = (e) => { state.embedThumbnail = e.target.checked; store.set('embedThumbnail', state.embedThumbnail); };
  $('opt-meta').onchange = (e) => { state.embedMetadata = e.target.checked; store.set('embedMetadata', state.embedMetadata); };
  $('opt-subs').onchange = (e) => { state.writeSubtitles = e.target.checked; store.set('writeSubtitles', state.writeSubtitles); };

  $('cookie-browser').value = state.cookies;
  $('cookie-browser').onchange = (e) => { state.cookies = e.target.value; store.set('cookies', state.cookies); };

  // Titlebar: pin + close
  const syncPinUI = () => {
    $('tb-pin').classList.toggle('active', state.pinned);
    $('opt-pin').checked = state.pinned;
    pushUIConfig();
  };
  $('tb-pin').onclick = () => { state.pinned = !state.pinned; store.set('pinned', state.pinned); syncPinUI(); };
  $('tb-close').onclick = () => window.prismofy.hide();

  // Appearance: theme swatches
  document.querySelectorAll('.swatch').forEach((s) => {
    s.onclick = () => applyTheme(s.dataset.theme);
  });
  // Custom accent
  $('accent-color').oninput = (e) => { state.customAccent = e.target.value; store.set('customAccent', state.customAccent); applyAccent(); };
  $('accent-reset').onclick = () => { state.customAccent = null; store.set('customAccent', null); applyAccent(); };

  // Pin / remember-position toggles
  $('opt-pin').checked = state.pinned;
  $('opt-rempos').checked = state.rememberPos;
  $('opt-pin').onchange = (e) => { state.pinned = e.target.checked; store.set('pinned', state.pinned); syncPinUI(); };
  $('opt-rempos').onchange = (e) => { state.rememberPos = e.target.checked; store.set('rememberPos', state.rememberPos); pushUIConfig(); };
  syncPinUI();

  $('choose-folder').onclick = async () => {
    const f = await window.prismofy.chooseFolder(state.downloadFolder);
    if (f) { state.downloadFolder = f; store.set('downloadFolder', f); $('folder-path').textContent = f; }
  };

  $('edit-priority').onclick = () => showScreen('priority');
  $('reset-priority').onclick = () => {
    state.videoOrder = VIDEO_FORMATS.map((f) => f.id);
    state.audioOrder = AUDIO_FORMATS.map((f) => f.id);
    store.set('videoOrder', state.videoOrder); store.set('audioOrder', state.audioOrder);
    renderPriority(); renderFormatDropdowns();
  };

  $('about-btn').onclick = () => showScreen('about');
  $('theme-select').onchange = (e) => applyTheme(e.target.value);

  // bottom bar
  $('bb-back').onclick = () => {
    if (view === 'priority' || view === 'about') showScreen('settings');
    else if (view === 'settings') showScreen('main');
    else showScreen('settings');
  };
  $('bb-folder').onclick = () => window.prismofy.openFolder(state.downloadFolder);
  $('bb-exit').onclick = () => window.prismofy.quit();

  // external links
  document.querySelectorAll('[data-ext]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); window.prismofy.openExternal(a.dataset.ext); };
  });

  // setup overlay buttons
  $('setup-exit').onclick = () => window.prismofy.quit();
  $('setup-retry').onclick = () => location.reload();

  // ---- main process events ----
  window.prismofy.onSetupState((p) => {
    if (p.state === 'ready') {
      state.setupReady = true;
      showScreen('main');
    } else {
      state.setupReady = false;
      $('setup').classList.remove('hidden');
      ['main', 'settings', 'priority', 'about'].forEach((s) => $(s).classList.add('hidden'));
      $('bottom-bar').classList.add('hidden');
      $('setup-spinner').classList.toggle('hidden', p.state === 'error');
      $('setup-error-icon').classList.toggle('hidden', p.state !== 'error');
      $('setup-actions').classList.toggle('hidden', p.state !== 'error');
      $('setup-title').textContent = p.state === 'error' ? 'Setup Failed'
        : (p.state === 'installing' ? 'Initial Setup in Progress' : 'Checking Environment…');
      $('setup-text').textContent = p.text || '';
      syncHeight();
    }
  });

  window.prismofy.onFfmpegAvailable((ok) => {
    state.ffmpeg = ok;
    $('ffmpeg-warn').classList.toggle('hidden', ok);
    $('ffmpeg-note').classList.toggle('hidden', ok);
  });

  window.prismofy.onDownloadProgress((p) => {
    $('bar-fill').style.width = `${Math.round(p.percent * 100)}%`;
    $('progress-pct').textContent = `${Math.round(p.percent * 100)}%`;
    $('progress-text').textContent = p.text;
  });

  window.prismofy.onDownloadError((msg) => { state.downloadError = msg; renderMessages(); });

  // start on setup screen until main says ready
  showScreen('setup');
  $('setup').classList.remove('hidden');
}

window.addEventListener('DOMContentLoaded', init);
