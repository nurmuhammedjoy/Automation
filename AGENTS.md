# AGENTS.md

Automation — a local-first, static PWA for running "AI workflows": chains of steps
(input → transcript → AI task → output) executed against the Groq API from the
browser. No framework, no backend, no build-time magic beyond Vite.

Read this before exploring the source. It exists so agents (and humans) don't
have to re-derive the architecture from raw greps.

## Commands

```sh
npm run dev       # Vite dev server
npm run build     # Production build → dist/ (only when explicitly requested)
npm run smoke     # happy-dom UI tests (no network; stubbed API) — only when requested
npm run check     # Fast sanity: syntax, PWA manifest/icons/sw, entry wiring
npm run icons     # Regenerate public/icons/*
```

`npm run smoke` is the project's verification, but do not run it during routine
development. Verify changes with `npm run dev`. Do not run `npm run build` unless
the user asks: it rewrites hashed `dist/` assets and changes bundle sizes, which
are just development noise here.

## Architecture at a glance

```
index.html → src/main.js (hash router: #flows, #runs, #settings)
             │
             ├─ views/flows/  (list + build/run of flows)  ← biggest module
             ├─ views/runs.js (run history UI)
             ├─ views/settings.js (API key, models, appearance, data)
             │
             ├─ store.js    app state (flows/settings/drafts) → localStorage
             ├─ db.js       run history → IndexedDB
             ├─ engine.js   executes a flow; emits fine-grained events
             ├─ api.js      Groq chat/transcribe + model listing
             ├─ data.js     constants: DEFAULT_FLOWS, model roles, step types
             ├─ theme.js    accent presets and generated palette tokens
             ├─ components.js UI primitives: modal, toast, menuSelect, markdown
             ├─ util.js     esc/format helpers      icons.js SVG icon set
             └─ styles.css  entry: @imports everything in src/styles/ (split by concern)
```

CSS is split by concern under `src/styles/` (`tokens`, `base`, `shell`,
`typography`, `controls`, `menu-select`, `surfaces`, `notices`, `flows`,
`settings`, `output`, `run-details`, `overlays`, `legacy`, `responsive`).
`src/styles.css` only holds `@import` statements — add new component styles to
the matching file there, not to the entry.

Nothing writes outside its own root element; every view is a function
`render(root, {parts}) => cleanup()`. Views render via template strings and
attach listeners manually — no virtual DOM, no reactivity.

## Core concepts

- **Flow** = `{ id, name, icon, steps[] }`. Step types: `input`, `transcribe`,
  `task`, `output` (see `STEP_META` in data.js).
  Creating step objects: only via `newWorkflowStep` / `createTaskStep` in data.js.
- **Run record** = frozen copy of a flow execution (`engine.createRunRecord`),
  saved to IndexedDB (`db.saveRun`, capped at `settings.keepRuns`). Post-run edits
  ("refine"/"redo") append to `run.versions`; they re-run from
  `run.snapshots[i].before` via `engine.refineRun`.
- **State** = single module-level object in `store.js` (import `state`, mutate
  through its exported actions only). Persisted to localStorage key
  `modu.state.v3`, debounced 180 ms (`saveState`), flushed on pagehide.
- **Engine events**: `engine.runFlow` emits `run:start`, `step:start`,
  `step:token`, `step:progress`, `step:log`, `step:meta`, `step:done`,
  `step:error`, `run:done`, `run:error`. Consumers update the live run UI
  (views/flows/run.js) instead of polling.

## Conventions

- **XSS**: all interpolated values go through `esc()` from util.js. Never insert
  unescaped user/API content into markup; markdown output renders through
  `components.streamingMarkdown` / `renderMarkdown`.
- **Models**: three roles (`smart`, `vision`, `stt`) in `settings.models`.
  Resolve per step with `resolveTaskModel` / `resolveSttModel`
  (data.js). Never call model id strings directly. Pickers filter by
  `modelKind` (util.js): utility models such as guard, safety, and embedding
  models are hidden. Image steps list vision models only; text steps list text
  models plus multimodal vision models such as Qwen 3.8 27B.
- **Image tasks**: the input type decides image usage. `syncImageInputTasks`
  (data.js) makes every task in an image flow use the image and drops text-only
  pinned models; text/audio flows clear the derived flag. There is no per-task
  attach toggle.
- **Selection menus**: use `components.menuSelectMarkup` + `bindMenuSelect` —
  selected value lives on the trigger's `dataset.value`, read via `picked(id)`.
- **File layout**: one concern per file; views under `views/`, shared logic in
  `src/*.js`. `views/flows/` uses an explicit index.js as its public entry.
- **Comments**: use them as navigation aids — one-line purpose header per file
  and short plain section labels (`// Build mode`, `/* Flow graph */`). No dashed
  or ASCII separator banners, and no comments that just restate the next line.
- **Style**: match surrounding code. Indent 2 spaces, template literals for
  markup, `strings + esc` for safety.

## Gotchas

- `state` is a singleton — never `import { state }` then treat it as local data;
  mutating nested keys won't persist unless you call its actions (`saveState`).
- Link downloads are intentionally unsupported: YouTube, Reels, TikTok, and
  other URLs cannot be fetched. Legacy `youtube`, `fetchAudio`, and `linkAudio`
  steps are dropped on load in `store.loadState` / `migrateLegacyFlow`; an old
  YouTube input becomes text, and a media input becomes an audio file input.
- Audio transcribe only supports files ≤ 24 MB (`MAX_DIRECT_AUDIO` in api.js).
- Audio inputs can be uploaded or recorded in-browser (`MediaRecorder` in
  views/flows/run.js). Recording needs HTTPS/localhost and microphone
  permission; the view cleanup calls `disposeRecorder(S)` so streams and timers
  do not outlive the run view.
- IndexedDB is not available in all test environments — `db.js` will reject.
  The runs view degrades gracefully (see smoke.mjs's "no IndexedDB required").

## Where to make changes

| Task | File(s) |
|---|---|
| New step type | data.js (`STEP_META`, `newWorkflowStep`), engine.js (runner branch), views/flows/validate.js, views/flows/editor.js (form), views/flows/shared.js (icon/title) |
| New flow model role | data.js (`MODEL_ROLE_META`, resolve*), settings.js, api.js |
| Live run UI | views/flows/run.js (`execute`, `renderLive`, audio recorder) |
| Post-run refine/redo | runui.js, engine.refineRun |
| Persistence schema | store.js version bump + migrateLegacyFlow pattern |
| New view/route | main.js ROUTES + views/newview.js |
