// Settings view: API key, model roles, appearance, and data tools.
import { DEFAULT_SETTINGS, MODEL_ROLE_META } from '../data.js'
import {
  clearRuns,
  countRuns,
} from '../db.js'
import { refreshModels } from '../api.js'
import {
  allModels,
  exportState,
  importState,
  models,
  resetAllState,
  setAccent,
  setSettings,
  state,
} from '../store.js'
import { icon } from '../icons.js'
import {
  ACCENT_PRESETS,
  accentLabel,
  accentSeed,
  isAccentColor,
} from '../theme.js'
import {
  $,
  $$,
  bindMenuSelect,
  confirmDialog,
  menuSelectMarkup,
  modelOptionsData,
  setBusy,
  toast,
} from '../components.js'
import {
  clamp,
  esc,
  formatDate,
} from '../util.js'

const APP_VERSION = '0.2.0'

function roleKind(role) {
  if (role === 'vision') return 'vision'
  if (role === 'stt') return 'stt'
  return 'text'
}

export function renderSettings(root) {
  let disposed = false
  let installListener = null

  function keyStatusMarkup() {
    const key = state.settings.apiKey || ''
    if (key) return `<span class="badge badge-ok">${icon('shield', 'size-3')} Saved on this device</span>`
    return `<span class="badge badge-err">No key yet</span>`
  }

  function modelsInfoMarkup() {
    const count = allModels().length
    const fetched = models.fetchedAt ? formatDate(models.fetchedAt) : 'not fetched yet'
    return `<span class="settings-meta">${icon('cloud', 'size-4')}<span>${count} models · ${esc(fetched)}${models.error ? ` · ${esc(models.error)}` : ''}</span></span>`
  }

  function render({ keepScroll = false } = {}) {
    if (disposed) return
    const y = window.scrollY
    const s = state.settings
    const roleVisuals = {
      smart: { icon: 'sparkles', tone: 'primary' },
      vision: { icon: 'image', tone: 'tertiary' },
      stt: { icon: 'mic', tone: 'secondary' },
    }
    const roleRows = Object.entries(MODEL_ROLE_META)
      .map(([role, meta]) => {
        const visual = roleVisuals[role] || roleVisuals.smart
        const options = modelOptionsData(s.models[role], {
          kind: roleKind(role),
          includeDefault: false,
        })
        return `<div class="settings-role-row">
          <span class="settings-icon" data-tone="${visual.tone}">${icon(visual.icon, 'size-5')}</span>
          <div class="settings-role-copy">
            <label class="settings-row-title" for="model-${role}">${esc(meta.label)}</label>
            <span class="settings-row-hint">${esc(meta.hint)}</span>
          </div>
          ${menuSelectMarkup({
            id: `model-${role}`,
            value: s.models[role] || '',
            className: 'menu-trigger-sm settings-model-select',
            attrs: `data-model-role="${role}"`,
            options,
          })}
        </div>`
      })
      .join('')

    const customAccent = isAccentColor(s.accent)
    const customColor = accentSeed(s.accent)
    const accentSwatches = ACCENT_PRESETS.map((preset) => {
      const active = s.accent === preset.id
      return `<button type="button" class="accent-swatch" data-accent="${esc(preset.id)}" style="--swatch: ${esc(preset.color)}" aria-label="${esc(preset.label)}" title="${esc(preset.label)}" aria-pressed="${active}"></button>`
    }).join('')

    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true
    const installPrompt = window.__appInstallPrompt
    const installHint = standalone
      ? 'The app is installed and available offline.'
      : installPrompt
        ? 'Adds the app to your home screen.'
        : 'Use your browser menu → Add to Home screen.'

    root.innerHTML = `<div>
      <header class="page-head">
        <div class="page-head-copy">
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">Your key, flows, and runs stay on this device. Only AI requests leave your browser.</p>
        </div>
      </header>

      <section class="settings-group">
        <h2 class="group-label">Groq connection</h2>
        <p class="group-support">Create a key at <a class="settings-link" href="https://console.groq.com" target="_blank" rel="noopener noreferrer">console.groq.com</a>. It stays in this browser.</p>

        <div class="card settings-card">
          <div class="settings-field">
            <div class="settings-field-head">
              <label class="label mb-0" for="api-key">API key</label>
              <span data-key-status>${keyStatusMarkup()}</span>
            </div>
            <div class="settings-input-action">
              <input id="api-key" class="input input-mono" type="password" value="${esc(s.apiKey)}"
                placeholder="gsk_…" autocomplete="off" autocapitalize="off" spellcheck="false" />
              <button type="button" class="btn-icon btn-icon-tonal" data-toggle-key aria-label="Show or hide key">${icon('eye', 'size-5')}</button>
            </div>
            <div class="settings-actions mt-3">
              <button type="button" class="btn btn-sm btn-primary" data-save-key>${icon('check', 'size-4')} Save key</button>
              <button type="button" class="btn btn-sm" data-test-connection>${icon('wifi', 'size-4')} Test &amp; fetch models</button>
            </div>
            <div class="settings-meta-row" data-models-info>${modelsInfoMarkup()}</div>
          </div>

          <details class="settings-disclosure" ${s.baseUrl !== DEFAULT_SETTINGS.baseUrl ? 'open' : ''}>
            <summary class="settings-disclosure-summary">
              ${icon('terminal', 'size-5')}
              <span>Advanced connection</span>
              ${icon('chevronDown', 'size-4 chevron')}
            </summary>
            <div class="settings-disclosure-body">
              <label class="label" for="base-url">API base URL</label>
              <input id="base-url" class="input" value="${esc(s.baseUrl)}" spellcheck="false"
                placeholder="${DEFAULT_SETTINGS.baseUrl}" />
              <p class="helper mt-2">Only change this for a compatible proxy or self-hosted gateway.</p>
            </div>
          </details>

        </div>
      </section>

      <section class="settings-group">
        <div class="settings-heading">
          <div class="settings-heading-copy">
            <h2 class="group-label">Model roles</h2>
            <p class="group-support">Each role is a default. Individual flow steps can override it.</p>
          </div>
          <button type="button" class="btn btn-sm btn-tonal" data-refresh-models>${icon('refresh', 'size-4')} Refresh</button>
        </div>

        <div class="card settings-card">${roleRows}</div>
        <p class="settings-note">Models are fetched from the provider when possible. Image steps use the Vision default.</p>
      </section>

      <section class="settings-group">
        <h2 class="group-label">Defaults</h2>
        <p class="group-support">Fallback values for AI steps, plus local history limits.</p>

        <div class="card settings-card">
          <div class="settings-field">
            <div class="settings-field-head">
              <label class="label mb-0" for="temperature">Temperature</label>
              <span class="settings-value" data-temp-value>${Number(s.temperature).toFixed(2)}</span>
            </div>
            <input id="temperature" class="mt-2 w-full" type="range" min="0" max="1.5" step="0.05" value="${esc(s.temperature)}" />
            <div class="settings-scale helper"><span>Precise</span><span>Creative</span></div>
          </div>

          <div class="settings-field settings-field-grid">
            <div>
              <label class="label" for="max-tokens">Max output tokens</label>
              <input id="max-tokens" class="input" type="number" min="256" max="32000" step="128" value="${esc(s.maxTokens)}" />
              <p class="settings-field-hint">Default ceiling for a single AI response.</p>
            </div>

            <div>
              <label class="label" for="keep-runs">Saved runs to keep</label>
              <input id="keep-runs" class="input" type="number" min="5" max="500" step="5" value="${esc(s.keepRuns)}" />
              <p class="settings-field-hint">Older runs are pruned after this many.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-group">
        <h2 class="group-label">Appearance</h2>
        <p class="group-support">Choose the color used for buttons, links, and highlights.</p>

        <div class="card settings-card">
          <div class="settings-field">
            <div class="settings-field-head">
              <span class="label">Accent color</span>
              <span class="settings-accent-name" data-accent-name aria-live="polite">${esc(accentLabel(s.accent))}</span>
            </div>
            <div class="accent-picker" role="group" aria-label="Accent color">
              <div class="accent-swatches">
                ${accentSwatches}
              </div>
              <label class="accent-swatch accent-swatch-custom" data-accent-custom-wrap data-selected="${customAccent}" style="--swatch: ${esc(customColor)}" title="Custom color">
                <input class="accent-color-input" type="color" value="${esc(customColor)}" data-accent-custom aria-label="Choose a custom accent color" />
                <span class="accent-custom-plus" aria-hidden="true">${icon('plus', 'size-4')}</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-group">
        <h2 class="group-label">Data &amp; backup</h2>
        <p class="group-support">Export settings and flows. Run history stays on this device.</p>

        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-icon" data-tone="primary">${icon('key', 'size-5')}</span>
            <div class="settings-row-main">
              <span class="settings-row-title">Include API key</span>
              <span class="settings-row-hint">Not recommended. Anyone with the file can use the key.</span>
            </div>
            <button type="button" class="switch" role="switch" aria-checked="false" data-export-key aria-label="Include API key"></button>
          </div>

          <div class="settings-field">
            <div class="settings-field-head settings-field-head-start">
              <span class="settings-icon" data-tone="secondary">${icon('download', 'size-5')}</span>
              <div class="settings-row-main">
                <span class="settings-row-title">Backup</span>
                <span class="settings-row-hint">Export or import settings and flows as JSON.</span>
              </div>
            </div>
            <div class="settings-actions mt-3">
              <button type="button" class="btn btn-sm btn-tonal" data-export>${icon('download', 'size-4')} Export backup</button>
              <button type="button" class="btn btn-sm" data-import>${icon('upload', 'size-4')} Import backup</button>
              <input type="file" class="hidden" accept="application/json,.json" data-import-file />
            </div>
          </div>

          <div class="settings-row">
            <span class="settings-icon" data-tone="neutral">${icon('history', 'size-5')}</span>
            <div class="settings-row-main">
              <span class="settings-row-title">Run history</span>
              <span class="settings-row-hint" data-run-count>Checking…</span>
            </div>
            <button type="button" class="btn btn-sm btn-danger hidden" data-clear-runs>${icon('trash', 'size-4')} Clear</button>
          </div>
        </div>
      </section>

      <section class="settings-group">
        <h2 class="group-label">About &amp; offline</h2>
        <p class="group-support">The interface is cached for offline use. AI calls still need a connection.</p>

        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-icon" data-tone="primary">${icon('download', 'size-5')}</span>
            <div class="settings-row-main">
              <span class="settings-row-title">Install app</span>
              <span class="settings-row-hint">${installHint}</span>
            </div>
            ${
              standalone
                ? `<span class="badge badge-ok">${icon('check', 'size-4')} Installed</span>`
                : installPrompt
                  ? `<button type="button" class="btn btn-sm btn-primary" data-install>${icon('download', 'size-4')} Install</button>`
                  : ''
            }
          </div>

          <div class="settings-row">
            <span class="settings-icon" data-tone="neutral">${icon('sparkles', 'size-5')}</span>
            <div class="settings-row-main">
              <span class="settings-row-title">Automation v${APP_VERSION}</span>
              <span class="settings-row-hint">Local-first · no analytics · no account.</span>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-group settings-danger-group">
        <h2 class="group-label settings-danger-label">${icon('alert', 'size-4')} Danger zone</h2>
        <p class="group-support">This action cannot be undone. Export a backup first if you want to keep anything.</p>

        <div class="card settings-card settings-danger-card">
          <div class="settings-row">
            <span class="settings-icon" data-tone="danger">${icon('alert', 'size-5')}</span>
            <div class="settings-row-main">
              <span class="settings-row-title">Reset app data</span>
              <span class="settings-row-hint">Delete the key, settings, flows, and saved runs from this device.</span>
            </div>
            <button type="button" class="btn btn-sm btn-danger-filled" data-reset>${icon('reset', 'size-4')} Reset</button>
          </div>
        </div>
      </section>
    </div>`

    bind()
    if (keepScroll) window.scrollTo({ top: y })
    refreshRunCount()
  }

  function refreshKeyStatus() {
    const el = $('[data-key-status]', root)
    if (el) el.innerHTML = keyStatusMarkup()
  }

  async function refreshRunCount() {
    const el = $('[data-run-count]', root)
    if (!el) return
    const clear = $('[data-clear-runs]', root)
    try {
      const n = await countRuns()
      if (disposed) return
      el.textContent = n ? `${n} saved run${n === 1 ? '' : 's'} in this browser.` : 'No saved runs.'
      clear?.classList.toggle('hidden', !n)
    } catch {
      if (disposed) return
      el.textContent = 'Run history is not available in this browser.'
      clear?.classList.add('hidden')
    }
  }

  function bind() {
    const keyInput = $('#api-key', root)
    keyInput?.addEventListener('input', () => {
      setSettings({ apiKey: keyInput.value.trim() })
      refreshKeyStatus()
    })

    $('[data-toggle-key]', root)?.addEventListener('click', () => {
      if (!keyInput) return
      const show = keyInput.type === 'password'
      keyInput.type = show ? 'text' : 'password'
      keyInput.focus()
    })

    $('[data-save-key]', root)?.addEventListener('click', () => {
      setSettings({ apiKey: (keyInput?.value || '').trim() })
      refreshKeyStatus()
      toast(state.settings.apiKey ? 'API key saved on this device' : 'API key cleared', 'success', 1800)
    })

    const baseInput = $('#base-url', root)
    baseInput?.addEventListener('change', () => {
      const value = baseInput.value.trim() || 'https://api.groq.com/openai/v1'
      setSettings({ baseUrl: value })
      baseInput.value = value
      toast('API base URL saved', 'success', 1500)
    })

    $('[data-test-connection]', root)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      setBusy(btn, true, 'Testing…')
      try {
        const result = await refreshModels()
        setBusy(btn, false)
        const info = $('[data-models-info]', root)
        if (info) info.innerHTML = modelsInfoMarkup()
        toast(`Connected. ${result.models.length} models available.`, 'success')
        render({ keepScroll: true })
      } catch (err) {
        setBusy(btn, false)
        toast(err.message || 'Could not reach the provider', 'error', 5000)
      }
    })

    $('[data-refresh-models]', root)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      setBusy(btn, true, 'Refreshing…')
      try {
        const result = await refreshModels()
        setBusy(btn, false)
        toast(`Model list updated (${result.models.length})`, 'success', 1800)
        render({ keepScroll: true })
      } catch (err) {
        setBusy(btn, false)
        toast(err.message || 'Could not fetch models', 'error', 4500)
      }
    })

    $$('[data-model-role]', root).forEach((trigger) => {
      const role = trigger.dataset.modelRole
      bindMenuSelect(trigger, {
        title: `${MODEL_ROLE_META[role]?.label || role} model`,
        options: modelOptionsData(state.settings.models[role], {
          kind: roleKind(role),
          includeDefault: false,
        }),
        onSelect: (value) => {
          setSettings({ models: { [role]: value } })
          toast(`${MODEL_ROLE_META[role]?.label || role} default updated`, 'success', 1500)
        },
      })
    })

    $('#temperature', root)?.addEventListener('input', (e) => {
      const value = clamp(Number(e.target.value) || 0, 0, 2)
      setSettings({ temperature: value })
      const label = $('[data-temp-value]', root)
      if (label) label.textContent = value.toFixed(2)
    })

    $('#max-tokens', root)?.addEventListener('change', (e) => {
      const value = clamp(Math.round(Number(e.target.value) || 3000), 256, 32000)
      e.target.value = value
      setSettings({ maxTokens: value })
    })

    $('#keep-runs', root)?.addEventListener('change', (e) => {
      const value = clamp(Math.round(Number(e.target.value) || 40), 5, 500)
      e.target.value = value
      setSettings({ keepRuns: value })
    })

    const updateAccentUi = (value) => {
      $$('[data-accent]', root).forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.accent === value))
      })
      const customWrap = $('[data-accent-custom-wrap]', root)
      const customInput = $('[data-accent-custom]', root)
      if (customWrap) {
        const custom = isAccentColor(value)
        customWrap.dataset.selected = String(custom)
        customWrap.style.setProperty('--swatch', accentSeed(value))
        if (customInput) customInput.value = accentSeed(value)
      }
      const name = $('[data-accent-name]', root)
      if (name) name.textContent = accentLabel(value)
    }

    $$('[data-accent]', root).forEach((button) => {
      button.addEventListener('click', () => {
        setAccent(button.dataset.accent)
        updateAccentUi(button.dataset.accent)
      })
    })

    $('[data-accent-custom]', root)?.addEventListener('input', (event) => {
      const value = event.target.value
      setAccent(value)
      updateAccentUi(value)
    })

    $('[data-export-key]', root)?.addEventListener('click', (e) => {
      const next = e.currentTarget.getAttribute('aria-checked') !== 'true'
      e.currentTarget.setAttribute('aria-checked', String(next))
    })

    $('[data-export]', root)?.addEventListener('click', () => {
      const includeKey = $('[data-export-key]', root)?.getAttribute('aria-checked') === 'true'
      const payload = exportState()
      if (!includeKey) payload.settings.apiKey = ''
      const date = new Date().toISOString().slice(0, 10)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `automation-backup-${date}.json`
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
      toast(includeKey ? 'Backup exported (includes key)' : 'Backup exported', 'success')
    })

    const importFile = $('[data-import-file]', root)
    $('[data-import]', root)?.addEventListener('click', () => importFile?.click())
    importFile?.addEventListener('change', async () => {
      const file = importFile.files?.[0]
      if (!file) return
      try {
        const payload = JSON.parse(await file.text())
        if (payload?.format === 'run') throw new Error('That is a saved run, not an app backup.')
        if (!payload?.settings && !payload?.flows) {
          throw new Error('This file does not look like an Automation backup.')
        }
        importState(payload)
        toast('Backup imported', 'success')
        render({ keepScroll: true })
      } catch (err) {
        toast(err.message || 'Could not import that file', 'error', 4500)
      } finally {
        importFile.value = ''
      }
    })

    $('[data-clear-runs]', root)?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Clear run history?',
        message: 'Every saved output, transcript, and version will be deleted from this device. Settings and flows are not affected.',
        confirmText: 'Clear runs',
        danger: true,
      })
      if (!ok) return
      try {
        await clearRuns()
        toast('Run history cleared', 'success')
        refreshRunCount()
      } catch (err) {
        toast(err.message || 'Could not clear runs', 'error')
      }
    })

    $('[data-reset]', root)?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset everything?',
        message: 'This deletes the API key, settings, flows, and every saved run from this device. Export a backup first if you want to keep anything.',
        confirmText: 'Reset app',
        danger: true,
      })
      if (!ok) return
      try {
        await clearRuns()
      } catch {}
      resetAllState()
      location.hash = '#flows'
      location.reload()
    })

    $('[data-install]', root)?.addEventListener('click', async () => {
      const prompt = window.__appInstallPrompt
      if (!prompt) {
        toast('Use your browser menu → Add to Home screen.', 'info', 3600)
        return
      }
      try {
        await prompt.prompt()
        await prompt.userChoice
      } catch {}
      window.__appInstallPrompt = null
      render({ keepScroll: true })
    })
  }

  installListener = () => {
    if (!disposed) render({ keepScroll: true })
  }

  window.addEventListener('app:install', installListener)
  render()

  return () => {
    disposed = true
    if (installListener) window.removeEventListener('app:install', installListener)
  }
}
