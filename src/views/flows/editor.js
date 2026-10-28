// Step editor modal: per-type fields, value collection, and dialog wiring.
import { INPUT_MODES, STT_LANGUAGES, clone } from '../../data.js'
import { icon } from '../../icons.js'
import { $, menuSelectMarkup, modelOptionsData, bindMenuSelect, showModal, toast } from '../../components.js'
import { esc, isVisionModel } from '../../util.js'
import { inputStep, stepTitle } from './shared.js'
import { stepSaveErrors } from './validate.js'

// Fields per step type
function stepEditorFields(next, { hasImageInput = false } = {}) {
  if (next.type === 'input') {
    return `<div class="grid gap-4">
      <div class="grid gap-4 xs:grid-cols-2">
        <div>
          <label class="label" for="step-mode">Input type</label>
          ${menuSelectMarkup({
            id: 'step-mode',
            value: next.mode || 'text',
            options: Object.entries(INPUT_MODES).map(([key, item]) => ({ value: key, label: item.label })),
          })}
        </div>
        <div>
          <label class="label" for="step-label">Label</label>
          <input id="step-label" class="input" value="${esc(next.label || '')}" placeholder="Input" />
        </div>
      </div>
      <div>
        <label class="label" for="step-placeholder">Placeholder</label>
        <input id="step-placeholder" class="input" value="${esc(next.placeholder || '')}" placeholder="Paste or type…" />
      </div>
    </div>`
  }

  if (next.type === 'transcribe') {
    return `<div class="grid gap-4 xs:grid-cols-2">
      <div>
        <label class="label" for="step-model">Speech model</label>
        ${menuSelectMarkup({
          id: 'step-model',
          value: next.model || '',
          options: modelOptionsData(next.model || '', {
            kind: 'stt',
            defaultLabel: 'Auto · Fast STT',
          }),
        })}
      </div>
      <div>
        <label class="label" for="step-language">Language</label>
        ${menuSelectMarkup({
          id: 'step-language',
          value: next.language || 'auto',
          options: STT_LANGUAGES.map(([code, label]) => ({ value: code, label })),
        })}
      </div>
      <div class="xs:col-span-2">
        <label class="label" for="step-prompt">Vocabulary hint <span class="normal-case text-faint">(optional)</span></label>
        <input id="step-prompt" class="input" value="${esc(next.prompt || '')}" placeholder="Names, acronyms, product terms…" />
      </div>
      <div class="xs:col-span-2 m-inline-note">${icon('mic', 'size-4')} Audio files must be under 24 MB. Export a smaller MP3 if needed.</div>
    </div>`
  }

  if (next.type === 'task') {
    const needsVision = hasImageInput
    return `<div class="grid gap-4">
      <div class="grid gap-4 xs:grid-cols-2">
        <div>
          <label class="label" for="step-name">Step name</label>
          <input id="step-name" class="input" value="${esc(next.name || 'AI task')}" />
        </div>
        <div>
          <label class="label" for="step-model">Model</label>
          ${menuSelectMarkup({
            id: 'step-model',
            value: next.model || '',
            options: modelOptionsData(next.model || '', {
              kind: needsVision ? 'vision' : 'text',
              defaultLabel: needsVision ? 'Auto · Vision' : 'Auto · Smart',
            }),
          })}
        </div>
      </div>

      <div>
        <div class="flex items-baseline justify-between gap-3">
          <label class="label mb-0" for="step-temperature">Creativity</label>
          <span class="helper tabular-nums" id="step-temp-label">${Number(next.temperature ?? 0.35).toFixed(2)}</span>
        </div>
        <input id="step-temperature" class="mt-2 w-full" type="range" min="0" max="1.5" step="0.05" value="${Number(next.temperature ?? 0.35)}" />
      </div>

      <div>
        <label class="label" for="step-instruction">Instruction</label>
        <textarea id="step-instruction" class="textarea" rows="5" placeholder="What should the AI do with the previous step's output?">${esc(next.instruction || '')}</textarea>
      </div>

      <details class="card overflow-hidden" ${next.system ? 'open' : ''}>
        <summary class="m-details-summary">${icon('wand', 'size-4')} Advanced prompt ${icon('chevronDown', 'size-4 chevron')}</summary>
        <div class="m-details-body step-advanced-body">
          <label class="label" for="step-system">System prompt</label>
          <textarea id="step-system" class="textarea" rows="5" placeholder="What should the AI do with the previous step's output?">${esc(next.system || '')}</textarea>
        </div>
      </details>
    </div>`
  }

  return `<div>
    <label class="label" for="step-label">Output label</label>
    <input id="step-label" class="input" value="${esc(next.label || 'Output')}" />
    <div class="mt-3 m-inline-note">${icon('check', 'size-4')} After a run, refine the last AI step without redoing the whole flow.</div>
  </div>`
}

// Read fields back into the step
export function applyEditorValues(modalRoot, next, { hasImageInput = false } = {}) {
  const read = (id) => $(`#${id}`, modalRoot)
  const picked = (id) => $(`#${id}`, modalRoot)?.dataset.value ?? ''
  if (next.type === 'input') {
    next.mode = picked('step-mode') || 'text'
    next.label = read('step-label')?.value || 'Input'
    next.placeholder = read('step-placeholder')?.value || ''
  } else if (next.type === 'transcribe') {
    next.model = picked('step-model') || ''
    next.language = picked('step-language') || 'auto'
    next.prompt = read('step-prompt')?.value || ''
  } else if (next.type === 'task') {
    next.name = read('step-name')?.value?.trim() || 'AI task'
    next.model = picked('step-model') || ''
    next.temperature = Number(read('step-temperature')?.value ?? 0.35)
    next.useImage = hasImageInput
    next.category = hasImageInput ? 'image' : 'text'
    next.instruction = read('step-instruction')?.value || ''
    next.system = read('step-system')?.value || ''
  } else if (next.type === 'output') {
    next.label = read('step-label')?.value || 'Output'
  }
}

// Needs S.saveSteps, S.remountBuild, S.moveStep, S.deleteStep (wired by detail.js).
export function openStepEditor(S, index, { isNew = false } = {}) {
  const source = S.flow.steps[index]
  if (!source) return
  const next = clone(source)
  const fixed = next.type === 'input' || next.type === 'output'
  const hasImageInput = inputStep(S.flow)?.mode === 'image'
  if (next.type === 'task' && hasImageInput && next.model && !isVisionModel(next.model)) {
    next.model = ''
  }

  const fields = () => stepEditorFields(next, { hasImageInput })

  let saved = false
  const modal = showModal({
    title: isNew ? `Add ${stepTitle(next)}` : `Edit ${stepTitle(next)}`,
    subtitle: fixed ? 'This node is fixed at the start or end of the chain.' : 'Configure the step, then tap Done.',
    maxWidth: '620px',
    body: fields(),
    footer: `<div class="w-full flex items-center justify-between gap-2">
      ${
        fixed || isNew
          ? `<span class="hidden xs:block" aria-hidden="true"></span>`
          : `<button type="button" class="btn-icon" data-step-menu aria-label="More options" aria-haspopup="dialog">${icon('moreVert', 'size-5')}</button>`
      }
      <div class="ml-auto flex flex-none gap-2">
        <button type="button" class="btn btn-sm btn-ghost" data-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-primary" data-save-step>Done</button>
      </div>
    </div>`,
    onClose: () => {
      if (!isNew || saved) return
      const position = S.flow.steps.findIndex((step) => step.id === next.id)
      if (position < 0) return
      S.flow.steps.splice(position, 1)
      S.saveSteps()
      S.remountBuild()
    },
    onMount: ({ root: modalRoot, close }) => {
      const stepModelTrigger = $('#step-model', modalRoot)
      const isTranscribe = next.type === 'transcribe'
      const modelKind = () => (isTranscribe ? 'stt' : hasImageInput ? 'vision' : 'text')
      const modelDefaultLabel = () =>
        isTranscribe ? 'Auto · Fast STT' : modelKind() === 'vision' ? 'Auto · Vision' : 'Auto · Smart'

      const refreshModelChoices = (preferred = next.model || '') => {
        if (!stepModelTrigger) return
        stepModelTrigger.dataset.value = preferred
        const current = modelOptionsData(preferred, {
          kind: modelKind(),
          defaultLabel: modelDefaultLabel(),
        }).find((item) => item.value === preferred)
        const label = $('[data-menu-label]', stepModelTrigger)
        if (label) label.textContent = current?.label || 'Select…'
      }

      if (stepModelTrigger) {
        bindMenuSelect(stepModelTrigger, {
          title: isTranscribe ? 'Speech model' : 'Model',
          stack: true,
          options: () =>
            modelOptionsData(stepModelTrigger.dataset.value, {
              kind: modelKind(),
              defaultLabel: modelDefaultLabel(),
            }),
          onSelect: (value) => refreshModelChoices(value),
        })
      }

      const stepModeTrigger = $('#step-mode', modalRoot)
      if (stepModeTrigger) {
        bindMenuSelect(stepModeTrigger, {
          title: 'Input type',
          stack: true,
          options: Object.entries(INPUT_MODES).map(([key, item]) => ({ value: key, label: item.label })),
        })
      }

      const languageTrigger = $('#step-language', modalRoot)
      if (languageTrigger) {
        bindMenuSelect(languageTrigger, {
          title: 'Language',
          stack: true,
          options: STT_LANGUAGES.map(([code, label]) => ({ value: code, label })),
        })
      }
      $('#step-temperature', modalRoot)?.addEventListener('input', (event) => {
        const label = $('#step-temp-label', modalRoot)
        if (label) label.textContent = Number(event.target.value).toFixed(2)
      })
      $('[data-cancel]', modalRoot).onclick = close
      $('[data-step-menu]', modalRoot)?.addEventListener('click', () => {
        showModal({
          stack: true,
          title: stepTitle(next),
          subtitle: 'Step actions',
          maxWidth: '360px',
          flush: true,
          body: `<div class="grid gap-2">
            <button type="button" class="m-menu-item" data-menu-up ${index <= 1 ? 'disabled' : ''}>${icon('up', 'size-4')} Move up</button>
            <button type="button" class="m-menu-item" data-menu-down ${index >= S.flow.steps.length - 2 ? 'disabled' : ''}>${icon('down', 'size-4')} Move down</button>
            <button type="button" class="m-menu-item m-danger" data-menu-remove>${icon('trash', 'size-4')} Remove step</button>
          </div>`,
          onMount: ({ root: menuRoot, close: closeMenu }) => {
            $('[data-menu-up]', menuRoot)?.addEventListener('click', () => {
              closeMenu()
              close()
              S.moveStep(index, -1)
            })
            $('[data-menu-down]', menuRoot)?.addEventListener('click', () => {
              closeMenu()
              close()
              S.moveStep(index, 1)
            })
            $('[data-menu-remove]', menuRoot)?.addEventListener('click', async () => {
              const removed = await S.deleteStep(index, true)
              closeMenu()
              if (removed) close()
            })
          },
        })
      })
      $('[data-move-up]', modalRoot)?.addEventListener('click', () => {
        close()
        S.moveStep(index, -1)
      })
      $('[data-move-down]', modalRoot)?.addEventListener('click', () => {
        close()
        S.moveStep(index, 1)
      })
      $('[data-delete-step]', modalRoot)?.addEventListener('click', async () => {
        const removed = await S.deleteStep(index, true)
        if (removed) close()
      })
      $('[data-save-step]', modalRoot).onclick = () => {
        applyEditorValues(modalRoot, next, { hasImageInput })
        const problems = stepSaveErrors(next)
        if (problems.length) {
          toast(problems[0], 'error')
          return
        }
        S.flow.steps[index] = next
        S.saveSteps()
        saved = true
        close()
        S.remountBuild()
        toast(isNew ? 'Step added' : 'Step updated', 'success', 1400)
      }
    },
  })
  return modal
}
