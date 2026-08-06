# SimRail Mobile EDR (React + PWA)

Phone-first Electronic Dispatch Record for SimRail.  
**Installable on your phone** as a Progressive Web App.

## What's improved

- Custom railway-themed app icon (192 / 512 / Apple touch)
- Proper web app manifest + maskable icons
- Install banner that appears when the browser allows installation
- Better iOS / Android meta tags (status bar, standalone mode)
- No white flash on load
- Offline-capable service worker (via Vite PWA plugin)
- Safe-area support for notched phones

## Quick Start

```bash
cd /home/workdir/artifacts/simrail-mobile-edr
npm install
npm run dev -- --host
```

The `--host` flag is important so your phone can reach the app on the same Wi-Fi.

### Install on Android (Chrome)

1. Open the URL shown by Vite on your phone
2. You should see an **Install Mobile EDR** banner near the bottom
3. Tap **Install**  
   (or use Chrome menu → Install app / Add to Home screen)

### Install on iOS (Safari)

1. Open the URL in Safari
2. Tap the Share button
3. Choose **Add to Home Screen**
4. Confirm

Once installed it opens fullscreen without the browser chrome.

## Features

- Clean mobile UI, no overflow
- **Skierniewice P / S / M → real destinations** (Płyćwia, Platforms, Koluszki/Żyrardów)
- Color-coded directions
- Filters + search
- Dark theme for night dispatching

## Project structure

```
src/
  App.tsx            # Main UI
  InstallPrompt.tsx  # PWA install banner
  data.ts            # Stations + post→destination mapping
  index.css
public/
  pwa-192.png / pwa-512.png / apple-touch-icon.png
  icon.svg
```

## Feedback

After testing on your phone, tell me what you want improved (layout, missing info, more stations, live data, etc.).
