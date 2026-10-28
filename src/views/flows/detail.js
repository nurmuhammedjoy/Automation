// Flow detail: build-mode graph and the shell shared by build/run modes (run logic in run.js).
import {
  STT_LANGUAGES,
  resolveSttModel,
  resolveTaskModel,
  newWorkflowStep,
  stepSummary,
  syncImageInputTasks,
} from '../../data.js'
import { deleteFlow, duplicateFlow, getFlow, resetFlow, saveDraft, state, updateFlow } from '../../store.js'
import { icon } from '../../icons.js'
import { $, $$, confirmDialog, emptyState, showModal, toast } from '../../components.js'
import { runResultMarkup } from '../../runui.js'
import { esc, shortModelName, truncate } from '../../util.js'
import { FLOW_ICONS, cachedRun, inputStep, outputStep, stepIcon, stepTitle } from './shared.js'
import { flowIssues } from './validate.js'
import { openStepEditor } from './editor.js'
import { runMarkup, bindRun, bindResult, disposeRecorder } from './run.js'

export function renderFlowDetail(root, flowId, mode) {
  let flow = getFlow(flowId)
  if (!flow) {
    root.innerHTML = `<div>
      <header class="page-head">
        <a href="#flows" class="btn-icon" aria-label="Back to flows">${icon('chevronLeft', 'size-6')}</a>
        <div class="page-head-copy"><h1 class="page-title">Flow not found</h1></div>
      </header>
      <div class="card">${emptyState({ iconName: 'alert', title: 'This flow is gone', text: 'It may have been deleted from this device.' })}</div>
    </div>`
    return () => {}
  }

  /* Mutable state shared with the run-mode module. All cross-module access
     goes through S, so building and running never touch each other's locals. */
  const S = {
    root,
    flowId,
    mode,
    flow,
    values: loadRunValues(flow),
    assets: { image: null, audioFile: null, audioUrl: '', audioOrigin: '' },
    recorder: null,
    recorderStarting: false,
    activeRun: cachedRun(flow.id) || null,
    selectedVersionId: '',
    busy: false,
    disposed: false,
    controller: null,
    lastFlow: null,
    lastInputs: null,
  }

  let saveTimer = 0
  let draftTimer = 0

  S.flushDraft = flushDraft
  S.queueDraft = queueDraft
  S.saveSteps = saveSteps
  S.remountBuild = remountBuild
  S.moveStep = moveStep
  S.deleteStep = deleteStep
  S.mount = mount

  function loadRunValues(f) {
    const d = state.drafts[`flow:${f.id}`] || {}
    return { text: d.text || '' }
  }

  function flushDraft() {
    clearTimeout(draftTimer)
    draftTimer = 0
    if (!getFlow(S.flow.id)) return
    saveDraft(`flow:${S.flow.id}`, { text: S.values.text })
  }

  function queueDraft() {
    clearTimeout(draftTimer)
    draftTimer = setTimeout(flushDraft, 350)
  }

  function refreshFlow() {
    S.flow = getFlow(S.flowId) || S.flow
    return S.flow
  }

  function saveSteps() {
    S.flow = syncImageInputTasks(S.flow)
    S.flow.updatedAt = Date.now()
    updateFlow(S.flow.id, { steps: S.flow.steps }, { touch: true })
    markSaving()
  }

  function markSaving() {
    const el = $('#save-state', root)
    if (!el) return
    el.innerHTML = `<span class="spinner"></span><span>Saving</span>`
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const node = $('#save-state', root)
      if (node) node.innerHTML = `${icon('check', 'size-3.5')}<span>Saved</span>`
    }, 500)
  }

  function navigateMode(next) {
    if (S.busy) {
      toast('Stop the current run before leaving.', 'info')
      return
    }
    flushDraft()
    location.hash = next === 'run' ? `#flows/${S.flow.id}/run` : `#flows/${S.flow.id}`
  }

  function mount({ keepScroll = false, scrollTo = '' } = {}) {
    if (S.disposed) return
    refreshFlow()
    const y = window.scrollY
    const validation = flowIssues(S.flow)
    const runArea =
      S.activeRun && S.activeRun.status !== 'running'
        ? runResultMarkup(S.activeRun, {
            versionId: S.selectedVersionId,
            allowRetry: true,
            showFlowLink: false,
          })
        : ''

    root.innerHTML = `<div>
      <header class="page-head">
        <a href="#flows" class="btn-icon shrink-0" aria-label="Back to flows">${icon('chevronLeft', 'size-6')}</a>
        <div class="page-head-copy">
          ${
            S.mode === 'build'
              ? `<input id="flow-name" class="m-title-input" value="${esc(S.flow.name)}" maxlength="60" aria-label="Flow name" />`
              : `<h1 class="page-title truncate">${esc(S.flow.name)}</h1>`
          }
          <div class="mt-1 flex items-center gap-2">
            ${S.mode === 'build' ? `<span id="save-state" class="m-saved">${icon('check', 'size-3.5')}<span>Saved</span></span>` : ''}
            <span class="helper">${S.mode === 'build' ? 'Changes save automatically' : `${S.flow.steps.length} steps`}</span>
          </div>
        </div>
        <button type="button" class="btn-icon" id="flow-menu" aria-label="Flow actions">${icon('moreVert', 'size-6')}</button>
      </header>

      <div class="m-segmented" role="tablist" aria-label="Flow mode">
        <button type="button" class="m-seg ${S.mode === 'build' ? 'active' : ''}" data-tab="build" role="tab" aria-selected="${S.mode === 'build'}">${icon('flows', 'size-4')} Build</button>
        <button type="button" class="m-seg ${S.mode === 'run' ? 'active' : ''}" data-tab="run" role="tab" aria-selected="${S.mode === 'run'}">${icon('play', 'size-4')} Run</button>
      </div>

      ${S.mode === 'build' ? buildMarkup(validation) : runMarkup(S, validation)}

      ${S.mode === 'run' ? `<div id="run-area">${runArea}</div>` : ''}
    </div>`

    bindHeader()
    if (S.mode === 'build') bindBuild()
    else bindRun(S)
    if (S.activeRun && S.activeRun.status !== 'running' && S.mode === 'run') {
      bindResult(S)
      if (scrollTo === 'result') {
        requestAnimationFrame(() => $('#run-area', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }
    }
    if (keepScroll) window.scrollTo({ top: y })
    else if (!scrollTo) window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function bindHeader() {
    $$('[data-tab]', root).forEach((btn) => {
      btn.addEventListener('click', () => navigateMode(btn.dataset.tab))
    })
    $('#flow-name', root)?.addEventListener('input', (e) => {
      S.flow.name = e.target.value
      updateFlow(S.flow.id, { name: e.target.value }, { touch: true })
      markSaving()
    })
    $('#flow-menu', root)?.addEventListener('click', () => openFlowDetailMenu())
  }

  function openFlowDetailMenu() {
    showModal({
      title: S.flow.name,
      subtitle: 'Flow actions',
      flush: true,
      body: `<div class="grid gap-2">
        <a href="#flows/${esc(S.flow.id)}/run" class="m-menu-item" data-close>${icon('play', 'size-4')} Run flow</a>
        <button type="button" class="m-menu-item" data-flow-details>${icon('edit', 'size-4')} Name, description &amp; icon</button>
        <button type="button" class="m-menu-item" data-duplicate>${icon('copy', 'size-4')} Duplicate flow</button>
        ${
          S.flow.builtIn
            ? `<button type="button" class="m-menu-item" data-reset>${icon('reset', 'size-4')} Reset template</button>`
            : `<button type="button" class="m-menu-item m-danger" data-delete>${icon('trash', 'size-4')} Delete flow</button>`
        }
      </div>`,
      onMount: ({ root: modalRoot, close }) => {
        $('[data-flow-details]', modalRoot)?.addEventListener('click', () => openFlowDetailsDialog())
        $('[data-duplicate]', modalRoot).onclick = () => {
          const copy = duplicateFlow(S.flow.id)
          close()
          if (copy) {
            toast('Flow duplicated', 'success')
            location.hash = `#flows/${copy.id}`
          }
        }
        $('[data-reset]', modalRoot)?.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Reset this template?',
            message: 'The graph and prompts will return to the original template.',
            confirmText: 'Reset',
          })
          if (!ok) return
          resetFlow(S.flow.id)
          close()
          refreshFlow()
          S.activeRun = null
          toast('Template reset', 'success')
          mount()
        })
        $('[data-delete]', modalRoot)?.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Delete this flow?',
            message: 'Saved runs keep their output. This flow will be removed from this device.',
            confirmText: 'Delete flow',
            danger: true,
          })
          if (!ok) return
          deleteFlow(S.flow.id)
          close()
          location.hash = '#flows'
        })
      },
    })
  }

  function openFlowDetailsDialog() {
    showModal({
      stack: true,
      title: 'Flow details',
      subtitle: 'Saved automatically',
      body: `<div class="grid gap-5">
        <div>
          <label class="label" for="flow-description">Description</label>
          <input id="flow-description" class="input" value="${esc(S.flow.description || '')}" placeholder="What is this flow for?" />
        </div>
        <div>
          <span class="label">Icon</span>
          <div class="flex flex-wrap gap-2">
            ${FLOW_ICONS.map(
              (name) =>
                `<button type="button" class="m-icon-choice ${S.flow.icon === name ? 'active' : ''}" data-flow-icon="${name}" aria-label="${name}" aria-pressed="${S.flow.icon === name}">${icon(name, 'size-5')}</button>`,
            ).join('')}
          </div>
        </div>
      </div>`,
      onMount: ({ root: sheet }) => {
        $('#flow-description', sheet)?.addEventListener('input', (e) => {
          S.flow.description = e.target.value
          updateFlow(S.flow.id, { description: e.target.value }, { touch: true })
          markSaving()
        })
        $$('[data-flow-icon]', sheet).forEach((btn) => {
          btn.addEventListener('click', () => {
            S.flow.icon = btn.dataset.flowIcon
            updateFlow(S.flow.id, { icon: S.flow.icon }, { touch: true })
            $$('[data-flow-icon]', sheet).forEach((choice) => {
              choice.classList.toggle('active', choice.dataset.flowIcon === S.flow.icon)
              choice.setAttribute('aria-pressed', String(choice.dataset.flowIcon === S.flow.icon))
            })
            markSaving()
          })
        })
      },
    })
  }

  function buildMarkup(validation) {
    const nodes = S.flow.steps
      .map((step, index) => {
        const fixed = step.type === 'input' || step.type === 'output'
        const summary = stepSummary(step)
        const next = S.flow.steps[index + 1]
        const canAdd = Boolean(next) && step.type !== 'output'
        const detail =
          step.type === 'task'
            ? truncate(step.instruction || 'Tap to write the instruction.', 110)
            : step.type === 'transcribe'
              ? `${step.language && step.language !== 'auto' ? STT_LANGUAGES.find(([code]) => code === step.language)?.[1] : 'Auto language'} · ${shortModelName(resolveSttModel(state.settings, step))}`
              : step.type === 'output'
                ? 'Final result, kept in Runs'
                : summary
        return `<div class="graph-node-row">
          <article class="graph-node ${fixed ? 'is-fixed' : ''}" data-step-card="${esc(step.id)}" data-index="${index}">
            <button type="button" class="graph-node-main" data-edit-step="${index}" aria-label="Configure ${esc(stepTitle(step))}">
              <span class="graph-node-icon" data-kind="${esc(step.type)}">${icon(stepIcon(step), 'size-5')}</span>
              <span class="min-w-0 flex-1 text-left">
                <span class="graph-node-title">${esc(stepTitle(step))}</span>
                <span class="graph-node-summary">${esc(detail)}</span>
                ${step.type === 'task' ? `<span class="graph-node-model">${icon('sparkles', 'size-3.5')} ${esc(shortModelName(resolveTaskModel(state.settings, step)))}</span>` : ''}
              </span>
              ${icon('chevronRight', 'size-5 graph-node-chevron')}
            </button>
          </article>
          ${
            canAdd
              ? `<div class="graph-link">
                  <span aria-hidden="true"></span>
                  <button type="button" class="graph-add" data-add-at="${index + 1}" aria-label="Add a step here" title="Add a step here">${icon('plus', 'size-4')}</button>
                  <span aria-hidden="true"></span>
                </div>`
              : ''
          }
        </div>`
      })
      .join('')

    return `<div class="m-group">
      ${
        validation.length
          ? `<div class="m-warning">
              <span class="shrink-0">${icon('alert', 'size-5')}</span>
              <div><strong>Almost ready</strong><ul>${validation.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
            </div>`
          : ''
      }

      <div class="flow-graph" aria-label="Workflow steps">
        ${nodes}
      </div>

      <button type="button" class="btn w-full" data-add-at="${S.flow.steps.length - (outputStep(S.flow) ? 1 : 0)}">${icon('plus', 'size-5')} ${outputStep(S.flow) ? 'Insert before output' : 'Add a step'}</button>
    </div>`
  }

  function bindBuild() {
    $$('[data-add-at]', root).forEach((btn) => {
      btn.addEventListener('click', () => openAddStep(Number(btn.dataset.addAt)))
    })
    $$('[data-edit-step]', root).forEach((btn) => {
      btn.addEventListener('click', () => openStepEditor(S, Number(btn.dataset.editStep)))
    })
  }

  function openAddStep(at) {
    const hasInput = Boolean(inputStep(S.flow))
    const hasOutput = Boolean(outputStep(S.flow))
    const choices = [
      { type: 'task', icon: 'sparkles', title: 'AI task', text: 'Run a prompt and pass the answer to the next step.' },
      { type: 'transcribe', icon: 'mic', title: 'Speech to text', text: 'Transcribe an audio file with Groq Whisper.' },
      ...(hasInput ? [] : [{ type: 'input', icon: 'text', title: 'Input', text: 'Choose text, image, or audio.' }]),
      ...(hasOutput ? [] : [{ type: 'output', icon: 'check', title: 'Output', text: 'Mark the result you want to keep and refine.' }]),
    ]
    showModal({
      title: 'Add a step',
      subtitle: 'It connects automatically in the chain.',
      flush: true,
      body: `<div class="grid gap-2">${choices
        .map(
          (choice) => `<button type="button" class="m-menu-item" data-module="${choice.type}">
            ${icon(choice.icon, 'size-4')} ${esc(choice.title)}
          </button>`,
        )
        .join('')}</div>`,
      onMount: ({ root: modalRoot, close }) => {
        $$('[data-module]', modalRoot).forEach((btn) => {
          btn.addEventListener('click', () => {
            const type = btn.dataset.module
            close()
            addModule(type, at)
          })
        })
      },
    })
  }

  function addModule(type, at) {
    const step = newWorkflowStep(type)
    let index = at
    if (type === 'input') {
      S.flow.steps.unshift(step)
      index = 0
    } else if (type === 'output') {
      S.flow.steps.push(step)
      index = S.flow.steps.length - 1
    } else {
      const outputIndex = S.flow.steps.findIndex((s) => s.type === 'output')
      const lastInsert = outputIndex > 0 ? outputIndex : S.flow.steps.length
      index = Math.max(1, Math.min(Number.isFinite(at) ? at : lastInsert, lastInsert))
      S.flow.steps.splice(index, 0, step)
    }
    saveSteps()
    remountBuild()
    if (type === 'task' || type === 'transcribe' || type === 'input') {
      openStepEditor(S, index, { isNew: true })
    } else {
      toast('Output step added', 'success', 1400)
    }
  }

  function moveStep(index, direction) {
    if (index <= 0 || index >= S.flow.steps.length - 1) return
    const target = index + direction
    if (target <= 0 || target >= S.flow.steps.length - 1) return
    const [step] = S.flow.steps.splice(index, 1)
    S.flow.steps.splice(target, 0, step)
    saveSteps()
    remountBuild()
    toast('Step moved', 'success', 1200)
  }

  async function deleteStep(index, stack = false) {
    const step = S.flow.steps[index]
    if (!step || step.type === 'input' || step.type === 'output') return false
    const ok = await confirmDialog({
      title: `Remove “${stepTitle(step)}”?`,
      message: 'The step and its settings will be removed from this flow.',
      confirmText: 'Remove step',
      danger: true,
      stack,
    })
    if (!ok) return false
    S.flow.steps.splice(index, 1)
    saveSteps()
    remountBuild()
    toast('Step removed', 'success', 1400)
    return true
  }

  function remountBuild() {
    const y = window.scrollY
    mount({ keepScroll: true })
    window.scrollTo({ top: y })
  }

  mount()

  return () => {
    S.disposed = true
    clearTimeout(saveTimer)
    clearTimeout(draftTimer)
    flushDraft()
    S.controller?.abort()
    disposeRecorder(S)
    if (S.assets.audioUrl) URL.revokeObjectURL(S.assets.audioUrl)
  }
}
