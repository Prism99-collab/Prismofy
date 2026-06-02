# Prismofy

**Just Download Anything.** Prismofy is a lightweight, tray-based media downloader for Windows — paste a link, pick a format, and download. It’s a clean Electron front-end powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/).

> Based on the macOS original by [arinltte](https://github.com/arinltte) — rebuilt and extended for Windows.

---

## ✨ Features

- 🎬 **Video** downloads (MP4 up to best quality, with automatic video+audio merge)
- 🎵 **Audio** extraction (MP3, M4A, FLAC, WAV, Opus — best quality)
- 🖼️ **Image** / direct-file downloads (any direct URL: images, PDFs, etc.)
- 🟢 **Spotify links** — resolves track/album/playlist metadata and downloads the matching audio from YouTube *(see note below)*
- 📋 **Multiple links** and playlist support with batch folders
- 🍪 **Browser cookies** option for age/region-restricted content
- 🪟 Minimal **system-tray** app — stays out of your way, one click to open
- ⚡ Bundled **ffmpeg** + auto-installed **yt-dlp**, so it works out of the box

Supports the hundreds of sites yt-dlp does (YouTube, SoundCloud, Vimeo, and many more).

---

## 📥 Install (for users)

1. Go to the [**Releases**](https://github.com/Prism99-collab/Prismofy/releases) page.
2. Download the latest **`Prismofy-Setup-x.y.z.exe`**.
3. Run it and follow the installer. A desktop + Start-menu shortcut is created automatically.
4. Launch **Prismofy** — on first run it fetches the latest yt-dlp (ffmpeg is bundled). Done.

> Windows SmartScreen may warn because the installer isn’t code-signed. Click **More info → Run anyway**.

---

## 🚀 Usage

1. Copy a link (YouTube, SoundCloud, Spotify, a direct file URL, …).
2. Open Prismofy and paste it — it auto-fetches the title/thumbnail.
3. Choose **Video**, **Audio**, or **Image**, and a format.
4. Click **Download**. Files go to your chosen folder (a folder button is in the footer).

Tick **Multiple Links** to queue several at once, or paste a playlist URL to pick tracks.

---

## ⚖️ Legal

Prismofy is a front-end for yt-dlp. Only download content you have the right to download. Respect the terms of service of the sites you use and applicable copyright law. The authors take no responsibility for misuse.

---

## 🛠️ Build from source (for developers)

**Requirements:** Windows, [Node.js](https://nodejs.org/) 18+, npm.

```bash
git clone https://github.com/Prism99-collab/Prismofy.git
cd Prismofy
npm install

# Run in dev
npm start

# Build the Windows installer (output in dist/)
npm run dist
```

### ffmpeg for builds
The committed repo does **not** include the large ffmpeg binaries (they’re git-ignored). Before running `npm run dist`, place static Windows builds here:

```
bin/ffmpeg.exe
bin/ffprobe.exe
```

Get them from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (the *essentials* build) or [BtbN](https://github.com/BtbN/FFmpeg-Builds/releases). electron-builder bundles them into the installer (`extraResources`), and Prismofy copies them into `%USERPROFILE%\.prismofy` on first run.

---

## 📂 Where things live

| Path | Purpose |
|------|---------|
| `%USERPROFILE%\.prismofy\` | yt-dlp, ffmpeg, config, cache |
| `%USERPROFILE%\.prismofy\Downloads\` | default download location |

---

## 🙏 Credits

- Original macOS app by [**arinltte**](https://github.com/arinltte)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [ffmpeg](https://ffmpeg.org/) · [Electron](https://www.electronjs.org/)

## 📜 License

[MIT](LICENSE) © 2026 Prism99
