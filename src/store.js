// App state singleton persisted to localStorage; exported actions mutate and save it.
import {
  DEFAULT_FLOWS,
  DEFAULT_SETTINGS,
  FALLBACK_MODELS,
  MODELS_KEY,
  STORAGE_KEY,
  clone,
  syncImageInputTasks,
} from './data.js'
import { isVisionModel, modelKind } from './util.js'
import { applyAccent } from './theme.js'

const STATE_VERSION = 4

function mergeBuiltins(stored = [], defaults = [], { keepModel = false } = {}) {
  const byId = new Map()
  for (const def of defaults) {
    const existing = stored.find((x) => x.id === def.id)
    if (existing) {
      const merged = { ...clone(def), ...existing }
      if (keepModel && existing.model) merged.model = existing.model
      merged.builtIn = true
      byId.set(def.id, merged)
    } else {
      byId.set(def.id, clone(def))
    }
  }
  for (const item of stored) {
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  return [...byId.values()]
}

// Load & migrate
function loadState() {
  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}
  } catch {
    saved = {}
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(saved.settings || {}),
    models: { ...DEFAULT_SETTINGS.models, ...(saved.settings?.models || {}) },
  }
  delete settings.downloadService
  delete settings.downloadApiKey
  delete settings.language
  delete settings.theme
  delete settings.demoMode
  delete settings.models.fast
  delete settings.models.sttAccurate
  if (Number(saved.version || 0) < STATE_VERSION && !isVisionModel(settings.models.vision)) {
    settings.models.vision = DEFAULT_SETTINGS.models.vision
  }

  const flows = mergeBuiltins(saved.flows, DEFAULT_FLOWS)
    .filter((flow) => !REMOVED_BUILTIN_FLOWS.has(flow.id))
    .map(migrateLegacyFlow)
    .map(syncImageInputTasks)

  return {
    version: STATE_VERSION,
    settings,
    flows,
    drafts: saved.drafts && typeof saved.drafts === 'object' ? saved.drafts : {},
    lastFlowId:
      saved.lastFlowId && flows.some((f) => f.id === saved.lastFlowId)
        ? saved.lastFlowId
        : flows[0].id,
  }
}

const REMOVED_BUILTIN_FLOWS = new Set([
  'flow-yt-transcript',
  'flow-yt-summary',
  'flow-reel-transcript',
])

/**
 * Earlier versions had yt-dlp, a YouTube captions step, and a media-link
 * download step. Those are dropped on load. A YouTube input falls back to
 * text, and a media input becomes an audio file input.
 */
function migrateLegacyFlow(flow) {
  if (!flow || !Array.isArray(flow.steps)) return flow
  const inputStep = flow.steps.find((step) => step.type === 'input')
  const mode = inputStep?.mode || 'text'
  const hasRemoved = flow.steps.some(
    (step) => step.type === 'youtube' || step.type === 'fetchAudio' || step.type === 'linkAudio',
  )
  const needsTranscribe =
    (mode === 'audio' || mode === 'media') &&
    !flow.steps.some((step) => step.type === 'transcribe')
  if (!hasRemoved && mode !== 'youtube' && mode !== 'media' && !needsTranscribe) return flow

  const steps = flow.steps
    .filter(
      (step) =>
        step.type !== 'youtube' && step.type !== 'fetchAudio' && step.type !== 'linkAudio',
    )
    .map((step) =>
      step.type === 'input' && (step.mode === 'youtube' || step.mode === 'media')
        ? { ...step, mode: step.mode === 'media' ? 'audio' : 'text' }
        : step,
    )

  if (needsTranscribe) {
    const at = steps.findIndex((item) => item.type === 'input')
    steps.splice(at >= 0 ? at + 1 : Math.max(0, steps.length - 1), 0, {
      id: `st_${Date.now().toString(36)}`,
      type: 'transcribe',
      model: '',
      language: 'auto',
      prompt: '',
    })
  }

  return { ...flow, steps }
}

export const state = loadState()

export const models = {
  list: [],
  fetchedAt: 0,
  error: '',
  loading: false,
}

// Older caches can miss fields or fallback models; rebuild them on read.
function normalizeModels(list = []) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const id = item?.id || item?.name || ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      ...item,
      id,
      label: item.label || item.name || id.split('/').pop(),
      kind: modelKind(id),
      active: item.active !== false,
    })
  }
  for (const fb of FALLBACK_MODELS) {
    if (!seen.has(fb.id)) out.push({ ...fb, fallback: true, active: true })
  }
  return out
}

try {
  const cached = JSON.parse(localStorage.getItem(MODELS_KEY) || 'null')
  if (cached?.list?.length) {
    models.list = normalizeModels(cached.list)
    models.fetchedAt = cached.fetchedAt || 0
  }
} catch {}

let persistTimer = 0
let persistQueued = false

// Persistence
export function saveState(reason = 'update') {
  persistQueued = true
  clearTimeout(persistTimer)
  persistTimer = setTimeout(saveNow, 180)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:state', { detail: { reason } }))
  }
}

export function saveNow() {
  if (!persistQueued) return
  persistQueued = false
  clearTimeout(persistTimer)
  try {
    // Strip runtime-only/unbounded values before writing.
    const payload = {
      version: state.version,
      settings: state.settings,
      flows: state.flows,
      drafts: state.drafts,
      lastFlowId: state.lastFlowId,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.warn('Could not save app state', err)
  }
}

export function applyAppearance() {
  document.documentElement.removeAttribute('data-theme')
  const surface = applyAccent(document.documentElement, state.settings.accent)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', surface || '#141218')
}

export function setSettings(patch, reason = 'settings') {
  state.settings = {
    ...state.settings,
    ...patch,
    models: { ...state.settings.models, ...(patch.models || {}) },
  }
  applyAppearance()
  saveState(reason)
}

export function setAccent(accent) {
  setSettings({ accent: String(accent || 'default') }, 'appearance')
}

export function dismissInstallHint() {
  setSettings({ installHintDismissed: true }, 'install-hint')
}

// Flow actions
export function getFlow(id) {
  return state.flows.find((f) => f.id === id) || null
}

export function updateFlow(id, patch, { touch = true } = {}) {
  const idx = state.flows.findIndex((f) => f.id === id)
  if (idx < 0) return null
  state.flows[idx] = {
    ...state.flows[idx],
    ...patch,
    id,
    ...(touch ? { updatedAt: Date.now() } : {}),
  }
  saveState('flow')
  return state.flows[idx]
}

export function addFlow(flow) {
  state.flows.unshift(flow)
  state.lastFlowId = flow.id
  saveState('flow-add')
  return flow
}

export function duplicateFlow(id) {
  const source = getFlow(id)
  if (!source) return null
  const now = Date.now()
  return addFlow({
    ...clone(source),
    id: `flow_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: `${source.name} copy`,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    steps: source.steps.map((s) => ({ ...clone(s), id: `st_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}` })),
  })
}

export function deleteFlow(id) {
  const flow = getFlow(id)
  if (!flow || flow.builtIn) return false
  state.flows = state.flows.filter((f) => f.id !== id)
  if (state.lastFlowId === id) state.lastFlowId = state.flows[0]?.id || ''
  saveState('flow-delete')
  return true
}

export function resetFlow(id) {
  const def = DEFAULT_FLOWS.find((f) => f.id === id)
  if (!def) return false
  const idx = state.flows.findIndex((f) => f.id === id)
  const reset = clone(def)
  if (idx >= 0) state.flows[idx] = reset
  else state.flows.push(reset)
  saveState('flow-reset')
  return true
}

export function saveDraft(key, patch) {
  state.drafts[key] = { ...(state.drafts[key] || {}), ...patch }
  saveState('draft')
}

export function setModelCache(list, fetchedAt = Date.now()) {
  models.list = normalizeModels(list)
  models.fetchedAt = fetchedAt
  models.error = ''
  try {
    localStorage.setItem(MODELS_KEY, JSON.stringify({ list: models.list, fetchedAt }))
  } catch {}
  window.dispatchEvent(new CustomEvent('app:models'))
}

export function allModels() {
  return models.list.length ? models.list : FALLBACK_MODELS
}

export function exportState() {
  return {
    exportedAt: new Date().toISOString(),
    app: 'automation',
    version: state.version,
    settings: { ...state.settings, apiKey: state.settings.apiKey },
    flows: state.flows,
  }
}

export function importState(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Not an Automation export')
  const flows = Array.isArray(payload.flows)
    ? mergeBuiltins(payload.flows, DEFAULT_FLOWS)
        .filter((flow) => !REMOVED_BUILTIN_FLOWS.has(flow.id))
        .map(migrateLegacyFlow)
        .map(syncImageInputTasks)
    : state.flows
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(payload.settings || {}),
    models: { ...DEFAULT_SETTINGS.models, ...(payload.settings?.models || {}) },
  }
  delete settings.downloadService
  delete settings.downloadApiKey
  delete settings.language
  delete settings.theme
  delete settings.demoMode
  delete settings.models.fast
  delete settings.models.sttAccurate
  if (Number(payload.version || 0) < STATE_VERSION && !isVisionModel(settings.models.vision)) {
    settings.models.vision = DEFAULT_SETTINGS.models.vision
  }
  if (!payload.settings?.apiKey) settings.apiKey = state.settings.apiKey
  state.settings = settings
  state.flows = flows
  state.lastFlowId = flows.some((f) => f.id === state.lastFlowId) ? state.lastFlowId : flows[0].id
  applyAppearance()
  saveState('import')
}

export function resetAllState() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(MODELS_KEY)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow()
  })
}
