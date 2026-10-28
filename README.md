# Automation

Simple, private AI workflows for your phone. Automation is a static PWA: build a
visual chain in **Flows**, run it, and keep every result in local **Runs**
history.

No account, analytics, or cloud. It runs entirely in the browser and calls Groq
directly with your own API key.

## What you get

- **Flows** — a visual graph of auto-connected steps. Tap a node to configure
  it, tap the plus between nodes to insert another step, and move or remove
  steps without drawing wires.
- **Inputs** — text, images, and audio: upload a file or record straight from the browser.
- **Runs** — local history, versions, transcripts, retry, and refinement.
- **PWA** — installable, offline app shell, mobile-first Material 3 interface.

## Run it

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL Vite prints. For a production build:

```bash
npm run build
npm run preview
```

Deploy the generated `dist/` folder to any static host (GitHub Pages, Netlify,
Cloudflare Pages, Vercel, a plain web server, etc.). Assets, manifest paths, and
the service worker are relative, so the build also works from a subpath such as
a GitHub project page. Serve it over HTTPS so installation and offline caching
work.

There is no backend to start and no environment file.

## Setup

1. Create a Groq API key at <https://console.groq.com>.
2. Open **Settings**, paste the key, and save it.
3. Optionally use **Test & fetch models** to confirm the connection.

Your key and all app data are stored in this browser. Requests go to the API
base URL in Settings (Groq by default).

## How inputs work

| Input | What happens |
| --- | --- |
| Text | Sent directly to the task model. |
| Image | Resized in the browser and attached to the AI tasks, then sent to a vision-capable model. |
| Audio | Upload a file or record it in the browser, then send it directly to Groq Whisper. Keep it under **24 MB**. |

Recording uses the microphone, so the browser will ask for permission. This
needs HTTPS (or localhost) and a browser with MediaRecorder support.

### Why the 24 MB audio limit?

Groq's direct transcription endpoint accepts files up to about 25 MB. Automation uses
24 MB as a safety margin. Export a smaller MP3 (64–96 kbps mono is usually
enough for speech) if your recording is larger.

## Flows

A flow is a short chain that runs top to bottom:

```text
Input → [Speech to text] → AI task → Output
```

- Input and Output are fixed at the ends.
- The plus controls between nodes insert a step exactly there.
- Tap any node to change its input type, model, language, or prompt.
- **AI task** steps are written from scratch: set the instruction, system
  prompt, model, and creativity.
- The graph warns you when a required step is missing.

## Scripts

```bash
npm run dev       # Vite development server
npm run build     # production build in dist/
npm run preview   # preview the production build
npm run check     # syntax + manifest/icon/PWA checks
npm run smoke     # happy-dom UI smoke tests (stubbed API)
npm run icons     # regenerate PWA icons
```

> **Contributing / AI agents:** see `AGENTS.md` first — it maps the modules,
> data flow, and conventions without needing to reverse-engineer the source.

## Privacy and storage

- API key, settings, flows, and drafts: browser `localStorage`.
- Run history, outputs, versions, and transcripts: browser IndexedDB.
- Nothing is uploaded to an Automation server; there isn't one.
- Text and images go to the provider you configure. Audio goes to Groq Whisper.
- Export a JSON backup from Settings. Saved runs are separate and stay in
  IndexedDB, so clear or back them up on the same device.

## Install

Use your browser's **Add to Home screen** / **Install app** action. The app
shell is cached for offline use, but AI requests still need a network
connection.

## Troubleshooting

**"Add your Groq API key"** — paste a key in Settings and save it. AI steps need
a key.

**Images fail or are ignored** — image flows attach the picture automatically.
Choose a vision model in Settings → Model roles (Qwen 3.8 27B by default), or
pin one in the step.

**Audio is rejected** — check that it is under 24 MB and in a format Groq
accepts (mp3, m4a, wav, ogg, webm).

**A model disappeared** — run **Refresh** in Settings. Automation also falls back to
known model IDs when the provider list is unavailable.

## Structure

```text
index.html                 app shell and navigation
src/main.js                hash router, appearance, service worker
src/styles.css             Material 3 tokens and components
src/api.js                 Groq chat/STT/models
src/engine.js              step runner, transcripts, refinement
src/data.js                flow templates and model defaults
src/theme.js               accent presets and generated palette tokens
src/store.js               local state, migrations, persistence
src/views/flows.js         visual flow graph and runner
src/views/runs.js          local run history
src/views/settings.js      connection, models, appearance, data
src/runui.js               shared output/version/refinement UI
public/                    manifest, icons, service worker
scripts/                   checks, smoke tests, icon generation
```
# Automation
