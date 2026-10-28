// App entry: hash router (#flows, #runs, #settings), appearance, and model refresh.
import { refreshModels } from './api.js'
import { closeModal, isStandalone, toast } from './components.js'
import { applyAppearance, models, saveNow, state } from './store.js'
import { esc } from './util.js'
import { renderFlows } from './views/flows/index.js'
import { renderRuns } from './views/runs.js'
import { renderSettings } from './views/settings.js'

const view = document.getElementById('view')

const ROUTES = {
  flows: { title: 'Flows', render: (parts) => renderFlows(view, { parts }) },
  runs: { title: 'Runs', render: (parts) => renderRuns(view, { parts }) },
  settings: { title: 'Settings', render: () => renderSettings(view) },
}

let cleanup = null
let routeKey = ''
let routeGeneration = 0

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '').trim()
  const segments = raw
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  const base = ROUTES[segments[0]] ? segments[0] : 'flows'
  return { base, parts: segments.slice(1), raw }
}

function setActiveTab(base) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const active = tab.dataset.tab === base
    tab.classList.toggle('active', active)
    if (active) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  })
}

function renderRoute({ focus = false } = {}) {
  const route = parseRoute()
  const key = `${route.base}/${route.parts.join('/')}`
  if (key === routeKey) return
  routeKey = key
  const generation = ++routeGeneration

  try {
    cleanup?.()
  } catch (err) {
    console.warn('View cleanup failed', err)
  }
  cleanup = null
  closeModal()
  setActiveTab(route.base)

  const entry = ROUTES[route.base]
  document.title = `${entry.title} · Automation`
  window.scrollTo({ top: 0, behavior: 'instant' })

  try {
    const result = entry.render(route.parts)
    if (typeof result === 'function') cleanup = result
  } catch (err) {
    console.error(err)
    view.innerHTML = `<div class="card settings-pad">
      <div class="settings-row-title">This view could not load</div>
      <p class="helper mt-2">${esc(String(err?.message || err))}</p>
      <button type="button" class="btn btn-sm mt-4" onclick="location.reload()">Reload</button>
    </div>`
  }

  if (focus && generation === routeGeneration) view.focus({ preventScroll: true })
}

function boot() {
  applyAppearance()
  renderRoute()

  window.addEventListener('hashchange', () => renderRoute({ focus: true }))
  window.addEventListener('app:state', (event) => {
    if (event.detail?.reason === 'appearance') applyAppearance()
  })

  const age = Date.now() - (models.fetchedAt || 0)
  const stale = state.settings.apiKey && (!age || age > 24 * 60 * 60 * 1000)
  if (stale) {
    refreshModels()
      .then(() => window.dispatchEvent(new CustomEvent('app:models')))
      .catch(() => {
        // Offline or invalid key: the UI already has fallback models.
      })
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    window.__appInstallPrompt = event
    window.dispatchEvent(new CustomEvent('app:install'))
  })
  window.addEventListener('appinstalled', () => {
    window.__appInstallPrompt = null
    toast('Automation installed', 'success')
  })

  window.addEventListener('pagehide', saveNow)
  window.addEventListener('beforeunload', saveNow)

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    const swUrl = new URL('../sw.js', new URL(import.meta.url)).href
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version is ready. Reopen the app to update.', 'info', 5000)
            }
          })
        })
      })
      .catch((err) => console.warn('Service worker registration failed', err))
  }

  if (isStandalone()) document.documentElement.dataset.standalone = 'true'
}

boot()
