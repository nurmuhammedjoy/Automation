// Runs view: history list, search, and saved-run detail.
import { refineRun } from '../engine.js'
import { deleteRun, listRunSummaries, getRun, saveRun, clearRuns } from '../db.js'
import { state } from '../store.js'
import { icon } from '../icons.js'
import {
  $,
  $$,
  confirmDialog,
  emptyState,
  streamingMarkdown,
  toast,
} from '../components.js'
import { bindRunResult, runResultMarkup, setRefineBusy, taskStepIndex } from '../runui.js'
import {
  downloadText,
  esc,
  formatDate,
  markdownToPlainText,
  safeFilename,
  shortModelName,
  truncate,
} from '../util.js'

export function renderRuns(root, { parts = [] } = {}) {
  const runId = parts[0]
  if (runId) return renderRunDetail(root, runId)

  let disposed = false
  let allRuns = []

  async function mount() {
    root.innerHTML = `<div>
      <header class="page-head">
        <div class="page-head-copy">
          <h1 class="page-title">Runs</h1>
          <p class="page-sub">Results saved on this device. Open a run to read, export, or refine it.</p>
        </div>
      </header>
      <div class="m-search">
        <span class="m-search-icon" aria-hidden="true">${icon('search', 'size-5')}</span>
        <input id="run-search" class="input" placeholder="Search runs" autocomplete="off" aria-label="Search runs" />
      </div>
      <div id="run-list" class="card">${emptyState({ iconName: 'history', title: 'Loading runs…' })}</div>
      <div class="runs-clear-wrap" id="runs-clear-wrap" hidden>
        <button type="button" class="btn btn-sm btn-danger" id="clear-runs">${icon('trash', 'size-4')} Clear all runs</button>
      </div>
    </div>`

    $('#run-search', root)?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase()
      let visible = 0
      $$('[data-run-card]', root).forEach((card) => {
        const hide = Boolean(q) && !card.dataset.search.includes(q)
        card.classList.toggle('hidden', hide)
        if (!hide) visible += 1
      })
      $('#no-run-match', root)?.classList.toggle('hidden', !(q && visible === 0))
    })
    $('#clear-runs', root)?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Clear all runs?',
        message: 'Every saved output, transcript, and refinement in this browser will be deleted.',
        confirmText: 'Clear runs',
        danger: true,
      })
      if (!ok) return
      try {
        await clearRuns()
        allRuns = []
        renderList()
        toast('Run history cleared', 'success')
      } catch (err) {
        toast(err.message || 'Could not clear runs', 'error')
      }
    })

    try {
      allRuns = await listRunSummaries()
      if (!disposed) renderList()
    } catch (err) {
      const list = $('#run-list', root)
      if (list) {
        list.innerHTML = `<div class="p-4 text-[13px] text-err">Run history is unavailable: ${esc(err.message)}</div>`
      }
    }
  }

  function renderList() {
    const list = $('#run-list', root)
    if (!list) return
    const clearWrap = $('#runs-clear-wrap', root)
    if (clearWrap) clearWrap.hidden = !allRuns.length
    if (!allRuns.length) {
      list.innerHTML = emptyState({
        iconName: 'history',
        title: 'No runs yet',
        text: 'Run a flow and the result, transcript, and refinements will appear here.',
        action: `<a href="#flows" class="btn btn-sm btn-primary mt-1">${icon('flows', 'size-4')} Open Flows</a>`,
      })
      return
    }
    const rows = allRuns
      .map((run) => {
        const plainOutput = markdownToPlainText(run.output || '') || 'No output'
        const search = `${run.title} ${run.flowName} ${plainOutput}`.toLowerCase()
        const status = run.status === 'done' ? 'Done' : run.status === 'cancelled' ? 'Stopped' : 'Error'
        const title = run.title || run.flowName
        const meta = [
          `<span class="run-status">${esc(status)}</span>`,
          `<span>${esc(formatDate(run.createdAt))}</span>`,
          run.stepCount ? `<span>${run.stepCount} steps</span>` : '',
        ]
          .filter(Boolean)
          .join('')
        return `<a href="#runs/${esc(run.id)}" class="run-row" data-run-card data-search="${esc(search)}">
          <span class="m-avatar">${icon(run.icon || 'sparkles', 'size-5')}</span>
          <span class="run-row-main">
            <span class="run-row-title" title="${esc(title)}">${esc(title)}</span>
            <span class="run-row-meta">${meta}</span>
            <span class="run-row-preview">${esc(truncate(plainOutput, 220))}</span>
          </span>
          ${icon('chevronRight', 'size-5 run-row-chevron')}
        </a>`
      })
      .join('')
    list.innerHTML = `<div class="run-list">${rows}</div>
      <div id="no-run-match" class="hidden px-4 py-8 text-center text-[13px] text-muted">No runs match your search.</div>`
  }

  mount()

  return () => {
    disposed = true
  }
}

function renderRunDetail(root, runId) {
  let run = null
  let disposed = false
  let selectedVersionId = ''
  let busy = false
  let controller = null

  root.innerHTML = `<div>
    <header class="m-top-app-bar">
      <a href="#runs" class="btn-icon" aria-label="Back to runs">${icon('chevronLeft', 'size-6')}</a>
      <div class="m-top-app-bar-copy"><div class="skeleton h-6 w-40"></div></div>
    </header>
    <div class="card"><div class="skeleton m-4 h-40"></div></div>
  </div>`

  async function load() {
    try {
      run = await getRun(runId)
    } catch (err) {
      if (disposed) return
      root.innerHTML = `<div>
        <header class="m-top-app-bar">
          <a href="#runs" class="btn-icon" aria-label="Back to runs">${icon('chevronLeft', 'size-6')}</a>
          <div class="m-top-app-bar-copy"><h1 class="m-top-app-bar-title">Run</h1></div>
        </header>
        <div class="card">${emptyState({ iconName: 'alert', title: 'Could not load this run', text: err.message || 'Try again from the Runs list.' })}</div>
      </div>`
      return
    }
    if (disposed) return
    if (!run) {
      root.innerHTML = `<div>
        <header class="m-top-app-bar">
          <a href="#runs" class="btn-icon" aria-label="Back to runs">${icon('chevronLeft', 'size-6')}</a>
          <div class="m-top-app-bar-copy"><h1 class="m-top-app-bar-title">Run</h1></div>
        </header>
        <div class="card">${emptyState({ iconName: 'history', title: 'Run not found', text: 'It may have been deleted or pruned from history.' })}</div>
      </div>`
      return
    }
    mount()
  }

  function mount({ keepScroll = false, scrollToResult = false } = {}) {
    if (disposed) return
    const y = window.scrollY
    const title = run.flowName || run.title || 'Run'
    const fullTitle = run.title || title
    const inputLabel =
      fullTitle.startsWith(`${title} · `) ? fullTitle.slice(title.length + 3) : fullTitle !== title ? fullTitle : ''
    const support = inputLabel || formatDate(run.updatedAt || run.createdAt)
    root.innerHTML = `<div>
      <header class="m-top-app-bar">
        <a href="#runs" class="btn-icon" aria-label="Back to runs">${icon('chevronLeft', 'size-6')}</a>
        <div class="m-top-app-bar-copy">
          <h1 class="m-top-app-bar-title" title="${esc(fullTitle)}">${esc(title)}</h1>
          <p class="m-top-app-bar-support" title="${esc(support)}">${esc(support)}</p>
        </div>
        <div class="m-top-app-bar-actions">
          <button type="button" class="btn-icon" id="export-run" aria-label="Export run" title="Export run">${icon('download', 'size-6')}</button>
          <button type="button" class="btn-icon m-top-app-bar-delete" id="delete-run" aria-label="Delete run" title="Delete run">${icon('trash', 'size-6')}</button>
        </div>
      </header>

      <div id="saved-run-result">${runResultMarkup(run, {
        versionId: selectedVersionId,
        showFlowLink: true,
        allowRetry: false,
        showTitle: false,
      })}</div>
    </div>`

    bind()
    if (keepScroll) window.scrollTo({ top: y })
    else if (!scrollToResult) window.scrollTo({ top: 0, behavior: 'instant' })
    if (scrollToResult) {
      requestAnimationFrame(() => {
        $('#saved-run-result', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  function bind() {
    const result = $('#saved-run-result', root)
    bindRunResult(result, run, {
      onVersionChange: (id) => {
        selectedVersionId = id || ''
        mount({ keepScroll: true })
      },
    })

    $('#delete-run', root)?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete this run?',
        message: 'Its output, transcript, versions, and refinements will be removed from this device.',
        confirmText: 'Delete run',
        danger: true,
      })
      if (!ok) return
      try {
        await deleteRun(run.id)
        toast('Run deleted', 'success')
        location.hash = '#runs'
      } catch (err) {
        toast(err.message || 'Could not delete run', 'error')
      }
    })

    $('#export-run', root)?.addEventListener('click', () => {
      const data = {
        ...run,
        exportedAt: new Date().toISOString(),
        app: 'automation',
        format: 'run',
      }
      downloadText(
        `${safeFilename(run.flowName || 'run')}-${new Date(run.createdAt).toISOString().slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
        'application/json',
      )
      toast('Run exported', 'success')
    })

    $('[data-apply-refine]', result)?.addEventListener('click', () => {
      const feedback = $('[data-refine-input]', result)?.value?.trim() || ''
      if (!feedback) {
        toast('Describe what you want changed first.', 'info')
        return
      }
      refine(feedback)
    })
    $('[data-redo]', result)?.addEventListener('click', () => refine(''))
    $('[data-stop-run]', result)?.addEventListener('click', () => controller?.abort())
  }

  async function refine(feedback) {
    if (busy || !run || run.status !== 'done') return
    if (!state.settings.apiKey) {
      toast('Add a Groq API key in Settings to refine.', 'info')
      return
    }
    const target = taskStepIndex(run)
    if (target < 0) {
      toast('This run has no refinable AI step.', 'info')
      return
    }
    const result = $('#saved-run-result', root)
    const preview = $('[data-refine-preview]', result)
    busy = true
    controller = new AbortController()
    setRefineBusy(result, true, feedback ? 'Revising…' : 'Redoing…')
    preview?.classList.remove('hidden')
    if (preview) preview.innerHTML = ''
    const streamer = preview ? streamingMarkdown(preview) : null

    try {
      const out = await refineRun({
        run,
        stepIndex: target,
        feedback,
        signal: controller.signal,
        onEvent: (evt) => {
          if (disposed) return
          if (evt.type === 'step:token') streamer?.push(evt.delta)
          if (evt.type === 'step:progress' && evt.message) {
            const el = $('[data-refine-status-text]', result)
            if (el) el.textContent = evt.message
          }
          if (evt.type === 'step:meta') {
            const el = $('[data-refine-status-text]', result)
            if (el) el.textContent = `${evt.revising ? 'Revising' : 'Running'} with ${shortModelName(evt.model)}…`
          }
        },
      })
      streamer?.finish()
      run = out.run
      selectedVersionId = ''
      busy = false
      controller = null
      try {
        await saveRun(run, Number(state.settings.keepRuns) || 40)
      } catch (err) {
        toast(`Revision is not saved: ${err.message}`, 'error')
      }
      if (disposed) return
      mount({ keepScroll: true, scrollToResult: true })
      toast(feedback ? 'Revision saved' : 'New version ready', 'success', 1600)
    } catch (err) {
      streamer?.cancel()
      if (disposed) return
      busy = false
      controller = null
      mount({ keepScroll: true })
      toast(err.name === 'AbortError' ? 'Stopped' : err.message || 'Refinement failed', err.name === 'AbortError' ? 'info' : 'error', 4000)
    }
  }

  load()

  return () => {
    disposed = true
    controller?.abort()
  }
}
