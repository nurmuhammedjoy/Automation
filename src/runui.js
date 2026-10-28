// Saved-run rendering: result card, step transcript, versions, refine/redo UI.
import { STEP_META } from './data.js'
import {
  icon,
} from './icons.js'
import {
  bindOutputToolbar,
  copyToClipboard,
  outputToolbar,
  showModal,
} from './components.js'
import {
  esc,
  formatDate,
  formatDuration,
  mdToHtml,
  shortModelName,
  truncate,
} from './util.js'

export function latestVersion(run) {
  return run?.versions?.length ? run.versions[run.versions.length - 1] : null
}

export function outputForVersion(run, versionId) {
  if (!run) return ''
  if (!versionId) return run.output || ''
  const v = run.versions?.find((x) => x.id === versionId)
  return v ? v.output : run.output || ''
}

export function runTranscript(run) {
  if (run?.context?.transcript) return run.context.transcript
  const entries = (run?.snapshots || []).filter(Boolean)
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].after?.transcript) return entries[i].after.transcript
  }
  return ''
}

export function runAudioInfo(run) {
  const entries = (run?.snapshots || []).filter(Boolean)
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].after?.audio) return entries[i].after.audio
  }
  return null
}

export function taskStepIndex(run) {
  if (!run?.flowSnapshot?.steps) return -1
  // Prefer a step that has a saved "before" snapshot (refinable).
  for (let i = run.flowSnapshot.steps.length - 1; i >= 0; i--) {
    const step = run.flowSnapshot.steps[i]
    if (step.type === 'task' && run.snapshots?.[i]?.before) return i
  }
  for (let i = run.flowSnapshot.steps.length - 1; i >= 0; i--) {
    if (run.flowSnapshot.steps[i].type === 'task') return i
  }
  return -1
}

function durationLabel(ms) {
  if (!ms) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
}

function versionTitle(v, index) {
  if (index === 0) return 'Original'
  return v.kind === 'redo' ? `Redo ${index}` : `Revision ${index}`
}

function versionTime(v) {
  return formatDate(v.at).split(', ').pop()
}

function openVersionSheet(versions, selectedId, onSelect, onDismiss) {
  const currentId = selectedId || versions[versions.length - 1]?.id || ''
  const latestId = versions[versions.length - 1]?.id
  const rows = versions
    .map((v, i) => {
      const checked = v.id === currentId
      return `<button type="button" class="version-option" role="radio" aria-checked="${checked}" data-version-option="${esc(v.id)}" ${checked ? 'data-autofocus' : ''}>
        <span class="version-option-state" aria-hidden="true">${icon(checked ? 'check' : 'history', 'size-[18px]')}</span>
        <span class="version-option-copy"><span class="version-option-title">${esc(versionTitle(v, i))}</span></span>
        <span class="version-option-meta">${esc(versionTime(v))}${v.id === latestId ? ' · Latest' : ''}</span>
      </button>`
    })
    .join('')

  let choosing = false
  let dismissed = false
  showModal({
    title: 'Revision history',
    subtitle: `${versions.length} saved versions`,
    flush: true,
    body: `<div class="version-list" role="radiogroup" aria-label="Revision">${rows}</div>`,
    onMount: ({ root, close }) => {
      const options = [...root.querySelectorAll('[data-version-option]')]
      const choose = (id) => {
        if (choosing) return
        choosing = true
        options.forEach((option) => {
          const checked = option.dataset.versionOption === id
          option.classList.toggle('selected', checked)
          option.setAttribute('aria-checked', String(checked))
        })
        if (id === currentId) {
          close()
          return
        }
        setTimeout(() => {
          if (dismissed) return
          close()
          onSelect(id)
        }, 160)
      }
      options.forEach((option, index) => {
        option.addEventListener('click', () => choose(option.dataset.versionOption))
        option.addEventListener('keydown', (e) => {
          let next = -1
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % options.length
          else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
            next = (index - 1 + options.length) % options.length
          else if (e.key === 'Home') next = 0
          else if (e.key === 'End') next = options.length - 1
          if (next >= 0) {
            e.preventDefault()
            options[next].focus()
          }
        })
      })
    },
    onClose: () => {
      dismissed = true
      onDismiss?.()
    },
  })
}

function stepsMarkup(run) {
  const steps = (run.steps || []).filter(Boolean)
  if (!steps.length) return ''
  const rows = steps
    .map((step) => {
      const meta = STEP_META[step.type] || STEP_META.task
      const errored = step.status === 'error' || step.status === 'cancelled'
      return `<div class="result-step">
        <span class="graph-node-icon result-step-icon ${errored ? 'graph-node-icon-error' : ''}" data-kind="${esc(step.type)}" aria-hidden="true">${icon(errored ? 'alert' : meta.icon, 'size-4')}</span>
        <div class="result-step-main">
          <div class="result-step-head">
            <span class="result-step-name">${esc(step.label || meta.label)}</span>
            ${step.durationMs ? `<span class="result-step-time">${durationLabel(step.durationMs)}</span>` : ''}
          </div>
          ${step.model ? `<div class="result-step-model">${esc(shortModelName(step.model))}</div>` : ''}
          ${step.outputPreview ? `<div class="result-step-preview">${esc(step.outputPreview)}</div>` : ''}
          ${step.error ? `<div class="result-step-error">${esc(step.error)}</div>` : ''}
        </div>
      </div>`
    })
    .join('')
  return `<details class="result-disclosure">
    <summary class="result-disclosure-summary">
      <span class="result-disclosure-label">Step details</span>
      <span class="result-disclosure-meta">${steps.length} steps</span>
      ${icon('chevronDown', 'size-4 result-chevron')}
    </summary>
    <div class="result-disclosure-body result-steps-body">${rows}</div>
  </details>`
}

export function refineMarkup(run, { stepIndex = taskStepIndex(run) } = {}) {
  if (stepIndex < 0) return ''
  return `<div data-refine class="result-refine">
    <div class="result-refine-head">
      <h3>Refine output</h3>
    </div>
    <textarea data-refine-input class="textarea textarea-sm result-refine-input" rows="2" placeholder="What should change?"></textarea>
    <div class="result-refine-chips">
      ${['Make it shorter', 'More natural', 'Add more detail', 'Simpler words', 'Keep the same format']
        .map(
          (p) =>
            `<button type="button" class="chip" data-quick-prompt="${esc(p)}">${esc(p)}</button>`,
        )
        .join('')}
    </div>
    <div class="result-refine-actions">
      <button type="button" class="btn btn-sm btn-primary" data-apply-refine>${icon('sparkles', 'size-4')} Apply feedback</button>
      <button type="button" class="btn btn-sm btn-tonal" data-redo>${icon('refresh', 'size-4')} Redo</button>
      <button type="button" class="btn btn-sm btn-danger hidden" data-stop-run>${icon('stop', 'size-4')} Stop</button>
    </div>
    <div data-refine-status class="result-refine-status hidden">
      <span class="spinner"></span><span data-refine-status-text>Working…</span>
    </div>
    <div data-refine-preview class="markdown result-refine-preview hidden"></div>
  </div>`
}

export function runResultMarkup(run, { versionId = '', showFlowLink = true, allowRetry = false, showTitle = true } = {}) {
  if (!run) return ''
  const versions = run.versions || []
  const selectedVersion = versionId ? versions.find((v) => v.id === versionId) : versions[versions.length - 1]
  const isOld = Boolean(versionId && selectedVersion && selectedVersion.id !== versions[versions.length - 1]?.id)
  const output = outputForVersion(run, selectedVersion?.id || '')
  const transcript = runTranscript(run)
  const audio = runAudioInfo(run)
  const transcriptLabel = 'Transcript'
  const stepIndex = taskStepIndex(run)
  const flow = run.flowSnapshot
  const words = transcript ? transcript.trim().split(/\s+/).filter(Boolean).length : 0
  const meta = [
    formatDate(run.updatedAt || run.createdAt),
    run.durationMs ? durationLabel(run.durationMs) : '',
    run.model ? shortModelName(run.model) : '',
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ')

  const selectedIndex = selectedVersion
    ? versions.findIndex((v) => v.id === selectedVersion.id)
    : versions.length - 1
  const revisionTitle = versions.length > 1 ? versionTitle(selectedVersion, Math.max(selectedIndex, 0)) : ''
  const revisionControl =
    versions.length > 1
      ? `<button type="button" class="version-trigger" data-version-trigger data-version-id="${esc(selectedVersion?.id || '')}" aria-haspopup="dialog" aria-expanded="false" aria-label="Choose revision. ${esc(revisionTitle)} selected.">
          ${icon('history', 'size-[18px] version-trigger-icon')}
          <span class="version-trigger-label">${esc(revisionTitle)}</span>
          ${icon('chevronDown', 'size-[18px] version-trigger-chevron')}
        </button>`
      : ''
  const canRefine = run.status === 'done' && stepIndex >= 0 && !isOld

  return `<section class="card result-card" data-run-result>
    <div class="result-head">
      <div class="result-head-main">
        ${showTitle ? `<h2 class="result-title">${esc(run.title || run.flowName || 'Run')}</h2>` : ''}
        <div class="result-meta">${meta}</div>
      </div>
      ${showFlowLink && flow?.id ? `<a class="btn-icon result-flow-link" href="#flows/${esc(flow.id)}" title="Open flow" aria-label="Open flow">${icon('flows', 'size-5')}</a>` : ''}
    </div>

    ${
      run.error
        ? `<div class="result-error">
            <div class="notice notice-error">
              <span class="notice-icon">${icon('alert', 'size-5')}</span>
              <div class="min-w-0 flex-1">
                <strong>${run.status === 'cancelled' ? 'Run stopped' : 'The run did not finish'}</strong>
                <div class="mt-1">${esc(run.error)}</div>
                ${
                  allowRetry
                    ? `<button type="button" class="btn btn-sm btn-primary mt-3" data-retry>${icon('refresh', 'size-4')} Retry run</button>`
                    : ''
                }
              </div>
            </div>
          </div>`
        : ''
    }

    ${
      output
        ? `<div class="result-output">
            <div class="result-toolbar">
              ${outputToolbar(output)}
              ${revisionControl}
            </div>
            ${
              isOld
                ? `<div class="result-version-note">
                    ${icon('history', 'size-4')} Earlier version
                    <button type="button" data-latest-version>View latest</button>
                  </div>`
                : ''
            }
            <div class="result-output-card">
              <div class="markdown result-markdown" data-output-md>${mdToHtml(output)}</div>
            </div>
          </div>`
        : run.error
          ? ''
          : `<div class="result-output result-empty">
              <div class="empty-state">
                ${icon('sparkles', 'size-6 text-faint')}
                <div class="empty-state-text">${run.status === 'running' ? 'Generating…' : 'No text output'}</div>
              </div>
            </div>`
    }

    ${
      audio?.audioUrl
        ? `<div class="result-block">
            <div class="result-block-label">${esc(audio.title || 'Audio')}${audio.duration ? ` · ${formatDuration(audio.duration)}` : ''}</div>
            <audio class="w-full" controls preload="none" src="${esc(audio.audioUrl)}"></audio>
          </div>`
        : ''
    }

    ${
      transcript
        ? `<details class="result-disclosure">
            <summary class="result-disclosure-summary">
              <span class="result-disclosure-label">${esc(transcriptLabel)}</span>
              <span class="result-disclosure-meta">${words} words</span>
              ${icon('chevronDown', 'size-4 result-chevron')}
            </summary>
            <div class="result-disclosure-body">
              <div class="transcript-box" data-transcript>${esc(transcript)}</div>
              <div class="result-transcript-actions">
                <button type="button" class="btn btn-xs btn-ghost" data-copy-transcript>${icon('copy', 'size-3.5')} Copy</button>
              </div>
            </div>
          </details>`
        : ''
    }

    ${stepsMarkup(run)}

    ${
      canRefine
        ? refineMarkup(run, { stepIndex })
        : ''
    }
  </section>`
}

export function bindRunResult(root, run, { onVersionChange, onRetry } = {}) {
  if (!root || !run) return
  const versionTrigger = root.querySelector('[data-version-trigger]')
  let currentVersionId = versionTrigger?.dataset.versionId || ''
  bindOutputToolbar(root, () => outputForVersion(run, currentVersionId), `${run.flowName || 'automation'}-output.md`)
  versionTrigger?.addEventListener('click', () => {
    versionTrigger.setAttribute('aria-expanded', 'true')
    openVersionSheet(
      run.versions || [],
      currentVersionId,
      (id) => {
        currentVersionId = id
        onVersionChange?.(id)
      },
      () => {
        versionTrigger.setAttribute('aria-expanded', 'false')
        if (versionTrigger.isConnected) requestAnimationFrame(() => versionTrigger.focus())
      },
    )
  })
  root.querySelector('[data-copy-transcript]')?.addEventListener('click', () => {
    copyToClipboard(runTranscript(run), 'Transcript copied')
  })
  root.querySelectorAll('[data-quick-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = root.querySelector('[data-refine-input]')
      if (!input) return
      const text = btn.dataset.quickPrompt || ''
      input.value = text
      input.focus()
    })
  })
  root.querySelector('[data-latest-version]')?.addEventListener('click', () => {
    currentVersionId = ''
    onVersionChange?.('')
  })
  root.querySelector('[data-retry]')?.addEventListener('click', () => onRetry?.())
}

export function setRefineBusy(root, busy, message = 'Working…') {
  const status = root?.querySelector('[data-refine-status]')
  const apply = root?.querySelector('[data-apply-refine]')
  const redo = root?.querySelector('[data-redo]')
  const stop = root?.querySelector('[data-stop-run]')
  const input = root?.querySelector('[data-refine-input]')
  if (status) {
    status.classList.toggle('hidden', !busy)
    status.classList.toggle('flex', busy)
    const text = status.querySelector('[data-refine-status-text]')
    if (text) text.textContent = message
    status.querySelector('.spinner')?.classList.toggle('hidden', !busy)
  }
  if (apply) {
    apply.disabled = busy
    apply.classList.toggle('hidden', busy)
  }
  if (redo) {
    redo.disabled = busy
    redo.classList.toggle('hidden', busy)
  }
  if (stop) stop.classList.toggle('hidden', !busy)
  if (input) input.disabled = busy
}

export function outputBadgeForRun(run) {
  const v = latestVersion(run)
  if (!v || v.kind === 'initial') return ''
  return v.kind === 'redo' ? 'Redo' : 'Revised'
}

export { truncate }
