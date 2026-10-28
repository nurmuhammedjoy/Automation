// Reusable UI primitives: modal, toast, menus, markdown, banners.
import { allModels, state } from './store.js'
import { MODEL_ROLE_META } from './data.js'
import { icon } from './icons.js'
import {
  copyText,
  esc,
  formatDate,
  mdToHtml,
  shortModelName,
} from './util.js'

export const $ = (sel, root = document) => root.querySelector(sel)
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

export function toast(message, kind = 'info', ms = 3200) {
  const root = document.getElementById('toast-root')
  if (!root) return
  const el = document.createElement('div')
  el.className = 'toast'
  el.dataset.kind = kind
  const iconName = kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info'
  el.innerHTML = `${icon(iconName, 'toast-icon')}<div class="min-w-0 flex-1">${esc(message)}</div>`
  root.append(el)
  const remove = () => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    el.style.transition = 'all 140ms'
    setTimeout(() => el.remove(), 160)
  }
  el.addEventListener('click', remove)
  if (ms > 0) setTimeout(remove, ms)
  return el
}

export function setBusy(button, busy, label) {
  if (!button) return
  if (busy) {
    if (!button.dataset.original) button.dataset.original = button.innerHTML
    button.disabled = true
    button.innerHTML = `<span class="spinner"></span><span>${esc(label || 'Working…')}</span>`
  } else {
    button.disabled = false
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original
      delete button.dataset.original
    } else if (label) {
      button.textContent = label
    }
  }
}

let closeActiveModal = null

/* M3E continuous slider: paint the filled fraction into --p for CSS.
   Delegated so every slider on any view is covered without per-view code. */
function paintM3eSlider(input) {
  const min = Number(input.min || 0)
  const max = Number(input.max || 100)
  let value = Number(input.value)
  if (!Number.isFinite(value)) value = 0
  const p = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0
  input.style.setProperty('--p', `${Math.min(100, Math.max(0, p))}%`)
  /* Close the gap when the handle reaches an end, like the M3E spec. */
  if (p <= 0 || p >= 100) input.style.setProperty('--gap', '0px')
  else input.style.removeProperty('--gap')
}

if (typeof document !== 'undefined') {
  const paintAllSliders = () => document.querySelectorAll('input[type="range"]').forEach(paintM3eSlider)
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'range') paintM3eSlider(event.target)
  })
  if (document.body) {
    if (typeof MutationObserver === 'function') {
      new MutationObserver(paintAllSliders).observe(document.body, { childList: true, subtree: true })
    }
    paintAllSliders()
  }
}

// Modal
export function showModal({
  title,
  subtitle = '',
  body = '',
  footer = '',
  onMount,
  onClose,
  maxWidth = '',
  stack = false,
  flush = false,
}) {
  const previousClose = stack ? closeActiveModal : null
  if (!stack) closeModal()
  const root = document.getElementById('modal-root')
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1" ${maxWidth ? `style="max-width:${esc(maxWidth)}"` : ''}>
      <div class="modal-head">
        <div class="modal-head-copy">
          <h2 class="modal-title">${esc(title)}</h2>
          ${subtitle ? `<p class="modal-sub">${esc(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="btn-icon shrink-0" data-close aria-label="Close">${icon('close', 'size-4')}</button>
      </div>
      <div data-modal-body class="modal-body${flush ? ' modal-body-flush' : ''}">${body}</div>
      ${footer ? `<div class="modal-foot" data-modal-footer>${footer}</div>` : ''}
    </div>`
  root.append(backdrop)
  const prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  const close = () => {
    if (!backdrop.isConnected) return
    backdrop.remove()
    document.body.style.overflow = prevOverflow
    document.removeEventListener('keydown', onKey)
    if (closeActiveModal === close) closeActiveModal = stack ? previousClose : null
    onClose?.()
  }
  const onKey = (e) => {
    if (e.key === 'Escape' && closeActiveModal === close) close()
  }
  closeActiveModal = close
  document.addEventListener('keydown', onKey)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })
  $$('[data-close]', backdrop).forEach((b) => b.addEventListener('click', close))
  onMount?.({ root: backdrop, close, body: $('[data-modal-body]', backdrop), footer: $('[data-modal-footer]', backdrop) })
  setTimeout(() => {
    const focusable =
      $(
        'input:not([type=file]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button[data-autofocus], [href]',
        backdrop,
      ) || $('.modal-panel', backdrop)
    focusable?.focus()
  }, 60)
  return { root: backdrop, close }
}

export function closeModal() {
  while (closeActiveModal) {
    const close = closeActiveModal
    close()
    if (closeActiveModal === close) break
  }
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  stack = false,
} = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const modal = showModal({
      title,
      stack,
      body: `<p class="text-sm leading-relaxed text-muted">${esc(message)}</p>`,
      footer: `<div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" data-cancel data-autofocus>${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger-filled' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>
      </div>`,
      onMount: ({ root, close }) => {
        $('[data-cancel]', root).onclick = () => {
          done(false)
          close()
        }
        $('[data-ok]', root).onclick = () => {
          done(true)
          close()
        }
      },
      onClose: () => done(false),
    })
    return modal
  })
}

export function openPromptDialog({
  title,
  label = '',
  value = '',
  placeholder = '',
  confirmText = 'Save',
  multiline = false,
  hint = '',
}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    showModal({
      title,
      body: `
        ${label ? `<label class="label" for="prompt-dialog-input">${esc(label)}</label>` : ''}
        ${
          multiline
            ? `<textarea id="prompt-dialog-input" class="textarea" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
            : `<input id="prompt-dialog-input" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" />`
        }
        ${hint ? `<p class="mt-2 text-xs leading-relaxed text-faint">${esc(hint)}</p>` : ''}
      `,
      footer: `<div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="button" class="btn btn-primary" data-ok>${esc(confirmText)}</button>
      </div>`,
      onMount: ({ root, close }) => {
        const input = $('[data-modal-body] input, [data-modal-body] textarea', root)
        const submit = () => {
          const val = input?.value ?? ''
          done(val)
          close()
        }
        $('[data-cancel]', root).onclick = () => {
          done(null)
          close()
        }
        $('[data-ok]', root).onclick = submit
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !multiline) {
            e.preventDefault()
            submit()
          }
        })
      },
      onClose: () => done(null),
    })
  })
}

// Model pickers
export function modelOptionsData(selected, { kind = 'text', includeDefault = true, defaultLabel = 'Default (Settings)' } = {}) {
  const list = allModels()
  const filtered = list.filter((m) => {
    if (m.kind === 'tts' || m.kind === 'utility') return false
    if (kind === 'stt') return m.kind === 'stt'
    if (kind === 'vision') return m.kind === 'vision'
    // Multimodal models also handle text, so keep them available for text steps.
    return m.kind === 'text' || m.kind === 'vision'
  })
  const groups = { vision: [], text: [], stt: [] }
  for (const m of filtered) (groups[m.kind] || groups.text).push(m)
  const hasSelected = !selected || filtered.some((m) => m.id === selected)
  const out = []
  if (includeDefault) {
    out.push({ value: '', label: defaultLabel })
  }
  if (!hasSelected && selected) {
    out.push({ value: selected, label: `${shortModelName(selected)} (saved)` })
  }
  if (groups.text.length) {
    out.push({ header: 'Text' }, ...groups.text.map((m) => ({ value: m.id, label: m.label || shortModelName(m.id) })))
  }
  if (groups.vision.length) {
    out.push({ header: 'Vision' }, ...groups.vision.map((m) => ({ value: m.id, label: m.label || shortModelName(m.id) })))
  }
  if (groups.stt.length) {
    out.push({ header: 'Speech to text' }, ...groups.stt.map((m) => ({ value: m.id, label: m.label || shortModelName(m.id) })))
  }
  return out
}

export function renderModelOptions(selected, options) {
  const data = modelOptionsData(selected, options)
  let html = ''
  let openGroup = ''
  for (const item of data) {
    if (item.header) {
      html += `${openGroup ? '</optgroup>' : ''}<optgroup label="${esc(item.header)}">`
      openGroup = item.header
    } else {
      html += `<option value="${esc(item.value)}" ${item.value === selected ? 'selected' : ''}>${esc(item.label)}</option>`
    }
  }
  return `${html}${openGroup ? '</optgroup>' : ''}`
}

/**
 * Field-styled trigger for a value picker. Pair with bindMenuSelect().
 * Opens a native-looking menu (the app's ⋮ menu pattern) instead of the
 * Android system select dialog, keeping list selection consistent.
 */
export function menuSelectMarkup({ id, value = '', options = [], className = '', attrs = '' } = {}) {
  const current = options.find((opt) => opt.value === value)
  return `<button type="button" id="${esc(id)}" class="menu-trigger ${className}" data-value="${esc(value ?? '')}" ${attrs} aria-haspopup="dialog" aria-expanded="false">
    <span class="menu-trigger-label" data-menu-label>${esc(current?.label || 'Select…')}</span>
    ${icon('chevronDown', 'size-[18px] menu-trigger-chevron')}
  </button>`
}

export function bindMenuSelect(trigger, { title = 'Choose an option', options = [], stack = false, onSelect } = {}) {
  if (!trigger || trigger.dataset.menuBound) return
  trigger.dataset.menuBound = '1'
  trigger.addEventListener('click', () => {
    if (trigger.disabled) return
    trigger.setAttribute('aria-expanded', 'true')
    const currentValue = trigger.dataset.value ?? ''
    const list = typeof options === 'function' ? options() : options
    const rows = list
      .map((item) =>
        item.header
          ? `<div class="menu-caption">${esc(item.header)}</div>`
          : (() => {
              const checked = item.value === currentValue
              return `<button type="button" class="menu-option ${checked ? 'selected' : ''}" role="radio" aria-checked="${checked}" data-menu-value="${esc(item.value)}" ${checked ? 'data-autofocus' : ''}>
                <span class="menu-option-state" aria-hidden="true">${checked ? icon('check', 'size-4') : ''}</span>
                <span class="menu-option-label">${esc(item.label)}</span>
              </button>`
            })(),
      )
      .join('')
    showModal({
      stack,
      flush: true,
      title,
      body: `<div class="grid gap-2" role="radiogroup">${rows}</div>`,
      onMount: ({ root: menuRoot, close }) => {
        $$('[data-menu-value]', menuRoot).forEach((option) => {
          option.addEventListener('click', () => {
            const value = option.dataset.menuValue ?? ''
            const chosen = list.find((item) => item.value === value)
            $$('[data-menu-value]', menuRoot).forEach((other) => {
              const active = other === option
              other.classList.toggle('selected', active)
              other.setAttribute('aria-checked', String(active))
            })
            trigger.dataset.value = value
            const label = $('[data-menu-label]', trigger)
            if (label && chosen?.label) label.textContent = chosen.label
            setTimeout(() => {
              close()
              onSelect?.(value)
            }, 150)
          })
        })
      },
      onClose: () => {
        if (trigger.isConnected) trigger.setAttribute('aria-expanded', 'false')
      },
    })
  })
}

export function modelChip(id) {
  if (!id) return ''
  return `<span class="badge">${esc(shortModelName(id))}</span>`
}

export function roleLabel(role) {
  return MODEL_ROLE_META[role]?.label || role
}

// Markdown
export function renderMarkdown(target, text) {
  if (!target) return
  target.innerHTML = mdToHtml(text)
}

export function streamingMarkdown(target, { onFlush } = {}) {
  let buffer = ''
  let timer = 0
  let dirty = false
  const flush = () => {
    timer = 0
    if (!target?.isConnected) return
    target.innerHTML = mdToHtml(buffer)
    dirty = true
    onFlush?.(buffer)
  }
  const schedule = () => {
    if (timer) return
    timer = setTimeout(flush, 70)
  }
  return {
    push(delta) {
      buffer += delta
      schedule()
    },
    set(text) {
      buffer = text
      schedule()
    },
    get text() {
      return buffer
    },
    finish() {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      flush()
      return buffer
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = 0
    },
    get dirty() {
      return dirty
    },
  }
}

export async function copyToClipboard(text, message = 'Copied') {
  const ok = await copyText(text)
  toast(ok ? message : 'Could not copy', ok ? 'success' : 'error', 1800)
  return ok
}

export function outputToolbar(text, { filename = 'automation-output.md', extra = '' } = {}) {
  return `<div class="output-toolbar" role="group" aria-label="Output actions">
    <button type="button" class="result-action" data-copy-output>${icon('copy', 'size-[18px]')}<span>Copy</span></button>
    ${extra}
  </div>`
}

export function bindOutputToolbar(container, getText) {
  $('[data-copy-output]', container)?.addEventListener('click', () => copyToClipboard(getText(), 'Output copied'))
}

// Small layout pieces
export function emptyState({ iconName = 'sparkles', title, text = '', action = '' }) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon(iconName, 'size-6')}</div>
    <div class="empty-state-title">${esc(title)}</div>
    ${text ? `<div class="empty-state-text">${esc(text)}</div>` : ''}
    ${action}
  </div>`
}

export function sectionHeader(title, subtitle = '', action = '') {
  return `<div class="section-head">
    <div class="min-w-0 flex-1">
      <h2>${esc(title)}</h2>
      ${subtitle ? `<p class="section-sub">${esc(subtitle)}</p>` : ''}
    </div>
    ${action}
  </div>`
}

export function statusPill(status) {
  const map = {
    running: ['Running', 'running'],
    done: ['Done', 'done'],
    error: ['Error', 'error'],
    cancelled: ['Stopped', 'error'],
    pending: ['Pending', 'pending'],
  }
  const [label, kind] = map[status] || [status, 'pending']
  return `<span class="badge ${kind === 'done' ? 'badge-ok' : kind === 'error' ? 'badge-err' : ''}"><span class="dot" data-state="${kind}"></span>${esc(label)}</span>`
}

export function formatRunMeta(run) {
  const parts = [formatDate(run.createdAt)]
  if (run.durationMs) parts.push(`${(run.durationMs / 1000).toFixed(run.durationMs < 10000 ? 1 : 0)}s`)
  if (run.model) parts.push(shortModelName(run.model))
  return parts.join(' · ')
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true
}

let bannerDismissPrefix = 'app-banner-'

// Delegated: any banner with a dismissal id hides and stays hidden for the session.
document.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('[data-banner-dismiss]')
  if (!trigger) return
  try {
    sessionStorage.setItem(`${bannerDismissPrefix}${trigger.dataset.bannerDismiss}`, '1')
  } catch {}
  trigger.closest('.m-banner')?.remove()
})

function bannerVisible(id) {
  try {
    return !sessionStorage.getItem(`${bannerDismissPrefix}${id}`)
  } catch {
    return true
  }
}

export function apiKeyBanner() {
  if (!state.settings.apiKey) {
    if (!bannerVisible('key')) return ''
    return `<div class="m-banner" role="status">
      <span class="m-banner-icon">${icon('key', 'size-[18px]')}</span>
      <div class="m-banner-text">
        <strong>Add a Groq API key</strong>
        <span>Run real tasks. Keys stay on this device.</span>
      </div>
      <a href="#settings" class="m-banner-action">Settings</a>
      <button type="button" class="m-banner-close" data-banner-dismiss="key" aria-label="Dismiss banner">${icon('close', 'size-4')}</button>
    </div>`
  }
  return ''
}

export function bindCopyButtons(root) {
  $$('[data-copy]', root).forEach((btn) => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy || '', 'Copied'))
  })
}
