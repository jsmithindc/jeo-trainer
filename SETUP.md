# Coryat Score Tracker — Setup & Deploy Guide

## Prerequisites
- Node.js 18+ (download from https://nodejs.org — use the LTS version)
- A free Netlify account (https://netlify.com)

---

## 1. Install dependencies

Open Terminal, navigate to this folder, and run:

```bash
npm install
```

This installs React, Vite, JSZip, sql.js, and the PWA plugin.

---

## 2. Copy the sql.js WASM file

The .apkg importer needs a WebAssembly file served from the public folder.
Run this one-time copy command:

```bash
cp node_modules/sql.js/dist/sql-wasm.wasm public/
```

---

## 3. Run locally (optional)

```bash
npm run dev
```

Open http://localhost:5173 in Safari. You can test the full app here before deploying.

---

## 4. Build for production

```bash
npm run build
```

This creates a `dist/` folder with everything bundled and ready to deploy.

---

## 5. Deploy to Netlify

### Option A: Drag and drop (easiest)
1. Go to https://app.netlify.com
2. Log in and go to your team dashboard
3. Drag the entire `dist/` folder onto the deploy drop zone
4. Done — Netlify gives you a live URL instantly

### Option B: Connect to GitHub (auto-deploys on every change)
1. Push this project to a GitHub repo
2. In Netlify: Add new site → Import from Git → select your repo
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Deploy — Netlify auto-deploys every time you push

---

## 6. Add to your iPhone home screen

1. Open the live Netlify URL in **Safari** on your iPhone
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add**

The app now lives on your home screen, opens full-screen with no browser chrome,
and works completely offline after the first load.

---

## Importing Anki decks

1. Open Anki on your Mac
2. File → Export
3. Select the deck you want
4. Format: **Anki Deck Package (.apkg)**
5. Click Export and save the file
6. In the app: Deck tab → Import .apkg → choose the file

---

## Notes

- **Data is stored in localStorage** — it persists across sessions but is tied
  to the browser/device. Clearing Safari's website data will erase it.
- The app works fully **offline** after first load (service worker caches all assets).
- The sql.js WASM file (~1.5MB) is what enables in-browser SQLite for .apkg parsing.
  It only loads when you actually use the import feature.
