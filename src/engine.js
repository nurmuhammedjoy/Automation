// Flow execution: runs steps in order and emits live progress events.
import {
  chatStream,
  transcribeAudio,
} from './api.js'
import {
  clone,
  resolveSttModel,
  resolveTaskModel,
  stepLabel,
} from './data.js'
import { state } from './store.js'
import {
  clamp,
  formatBytes,
  isAbort,
  isVisionModel,
  markdownToPlainText,
  parseError,
  truncate,
  uid,
  wordCount,
} from './util.js'

export function emptyContext() {
  return {
    text: '',
    image: null,
    audio: null,
    transcript: '',
    transcriptModel: '',
    output: '',
    lastTask: null,
  }
}

function sanitizeImage(image) {
  if (!image) return null
  return {
    name: image.name || 'image.jpg',
    size: image.size || 0,
    originalSize: image.originalSize || 0,
    width: image.width || 0,
    height: image.height || 0,
    dataUrl: image.dataUrl || '',
  }
}

function snapshotContext(ctx) {
  return {
    text: ctx.text || '',
    image: ctx.image
      ? {
          name: ctx.image.name || 'image.jpg',
          size: ctx.image.size || 0,
          width: ctx.image.width || 0,
          height: ctx.image.height || 0,
          dataUrl: '',
        }
      : null,
    audio: ctx.audio
      ? {
          title: ctx.audio.title || ctx.audio.name || '',
          duration: ctx.audio.duration || 0,
          size: ctx.audio.size || 0,
          mime: ctx.audio.mime || '',
        }
      : null,
    transcript: ctx.transcript || '',
    transcriptModel: ctx.transcriptModel || '',
    output: ctx.output || '',
    lastTask: ctx.lastTask ? clone(ctx.lastTask) : null,
  }
}

export function sanitizeInputs(inputs = {}) {
  return {
    text: String(inputs.text || ''),
    image: inputs.image ? sanitizeImage(inputs.image) : null,
    audioMeta: inputs.audioFile
      ? {
          name: inputs.audioFile.name || 'audio',
          size: inputs.audioFile.size || 0,
          type: inputs.audioFile.type || '',
        }
      : null,
  }
}

export function hydrateContext(context, inputs) {
  const ctx = { ...emptyContext(), ...clone(context || {}) }
  if (inputs?.image?.dataUrl && (!ctx.image || !ctx.image.dataUrl)) {
    ctx.image = clone(inputs.image)
  }
  return ctx
}

export function buildTaskMessages(step, context, opts = {}) {
  const { feedback = '', previousOutput = '', model = '' } = opts
  const instruction = (step.instruction || '').trim() || 'Complete the task using the input below.'
  const system =
    (step.system || '').trim() ||
    'You are a precise, helpful assistant. Follow the instruction and never invent details.'
  const inputText = (context.text || '').trim()
  const hasImage = Boolean(context.image?.dataUrl) && step.useImage !== false

  if (hasImage && model && !isVisionModel(model)) {
    throw new Error(
      `"${model}" does not support images. Choose a vision model for this step in Settings → Models.`,
    )
  }

  let userText = instruction
  if (inputText) {
    userText += `\n\n---\nINPUT:\n${inputText}`
  }
  if (hasImage) {
    const note = inputText ? '' : 'Analyse the attached image.'
    userText += `\n\n${note}${note ? ' ' : ''}An image is attached.`
  }

  const firstContent = hasImage
    ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: context.image.dataUrl } },
      ]
    : userText

  const messages = [{ role: 'system', content: system }, { role: 'user', content: firstContent }]

  if (feedback && previousOutput) {
    messages.push({ role: 'assistant', content: previousOutput })
    messages.push({
      role: 'user',
      content: [
        'Revise your previous answer using the feedback below.',
        '',
        'FEEDBACK:',
        feedback.trim(),
        '',
        'Return the complete revised answer only. Keep the parts that already work, fix only what the feedback asks for, and do not mention the revision process.',
      ].join('\n'),
    })
  }

  return messages
}

function applyInputStep(step, inputs = {}) {
  const ctx = emptyContext()
  const mode = step.mode || 'text'
  if (mode === 'text' || mode === 'auto') ctx.text = String(inputs.text || '')
  if ((mode === 'image' || mode === 'auto') && inputs.image) ctx.image = sanitizeImage(inputs.image)
  if (mode === 'image') ctx.text = String(inputs.text || '')
  if ((mode === 'audio' || mode === 'auto') && inputs.audioFile) {
    ctx.audio = {
      blob: inputs.audioFile,
      name: inputs.audioFile.name || 'audio',
      size: inputs.audioFile.size || 0,
      mime: inputs.audioFile.type || '',
    }
  }
  return ctx
}

function addUsage(total, usage) {
  if (!usage) return total
  const out = { ...(total || {}) }
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'seconds']) {
    if (Number.isFinite(Number(usage[key]))) out[key] = (out[key] || 0) + Number(usage[key])
  }
  return out
}

function previewFor(step, after) {
  switch (step.type) {
    case 'input':
      if (after.image) return `${after.image.name} · ${after.image.width}×${after.image.height}`
      return truncate(after.text, 140) || 'Empty input'
    case 'transcribe':
      return `${wordCount(after.transcript)} words · ${truncate(after.transcript, 160)}`
    case 'task':
      return truncate(markdownToPlainText(after.lastTask?.output || after.text), 180)
    case 'output':
      return truncate(markdownToPlainText(after.output || after.text), 180)
    default:
      return ''
  }
}

export function createRunRecord({ flow, inputs, title, icon }) {
  const lastTask = [...flow.steps].reverse().find((s) => s.type === 'task')
  const model = lastTask ? resolveTaskModel(state.settings, lastTask) : ''
  const now = Date.now()
  return {
    id: uid('run'),
    title: title || flow.name || 'Run',
    flowId: flow.id,
    flowName: flow.name || 'Custom flow',
    icon: icon || flow.icon || 'sparkles',
    source: flow.source || 'flows',
    createdAt: now,
    updatedAt: now,
    status: 'running',
    inputs: sanitizeInputs(inputs),
    flowSnapshot: clone(flow),
    steps: [],
    snapshots: [],
    context: null,
    output: '',
    outputPreview: '',
    versions: [],
    model,
    usage: null,
    durationMs: 0,
    error: '',
  }
}

export function applyRunResult(run, result) {
  run.status = 'done'
  run.updatedAt = Date.now()
  run.durationMs = result.durationMs
  run.steps = result.steps
  run.snapshots = result.snapshots
  run.context = result.context
  run.output = result.output
  run.outputPreview = truncate(markdownToPlainText(result.output), 280)
  run.usage = result.usage
  run.model = result.model || run.model
  run.error = ''
  const lastTaskIndex = findLastTaskIndex(run.flowSnapshot)
  if (!run.versions?.length) {
    run.versions = [
      {
        id: uid('ver'),
        at: run.createdAt,
        kind: 'initial',
        label: 'Initial',
        feedback: '',
        output: result.output,
        stepIndex: lastTaskIndex,
      },
    ]
  }
  return run
}

export function applyRunError(run, err) {
  const partial = err?.partial
  run.status = err?.name === 'AbortError' ? 'cancelled' : 'error'
  run.updatedAt = Date.now()
  run.error = parseError(err)
  if (partial) {
    run.steps = partial.steps
    run.snapshots = partial.snapshots
    run.context = partial.context
    run.output = partial.context?.output || partial.context?.text || ''
    run.outputPreview = truncate(markdownToPlainText(run.output), 280)
  }
  return run
}

function findLastTaskIndex(flow) {
  if (!flow?.steps) return -1
  for (let i = flow.steps.length - 1; i >= 0; i--) {
    if (flow.steps[i].type === 'task') return i
  }
  return -1
}

function stepLabelFor(step) {
  return stepLabel(step)
}

// Run a flow start to finish
export async function runFlow({
  flow,
  inputs = {},
  startIndex = 0,
  baseContext = null,
  refineStepIndex = -1,
  feedback = '',
  previousOutput = '',
  onEvent,
  signal,
}) {
  if (!flow?.steps?.length) throw new Error('This flow has no steps.')
  const startedAt = performance.now()
  const emit = (event) => {
    try {
      onEvent?.(event)
    } catch (err) {
      console.warn('Event handler failed', err)
    }
  }

  let context = baseContext ? hydrateContext(baseContext, inputs) : emptyContext()
  const stepsMeta = new Array(flow.steps.length).fill(null)
  const snapshots = new Array(flow.steps.length).fill(null)
  let usage = null
  let lastModel = ''
  let currentIndex = -1

  emit({ type: 'run:start', flow, steps: flow.steps })

  try {
    for (let index = startIndex; index < flow.steps.length; index++) {
      const step = flow.steps[index]
      currentIndex = index
      const stepStart = performance.now()
      const before = snapshotContext(context)
      emit({ type: 'step:start', index, step, label: stepLabelFor(step) })

      if (step.type === 'input') {
        context = applyInputStep(step, inputs)
        if (context.image) {
          emit({ type: 'step:log', index, message: `Image ready (${formatBytes(context.image.size)})` })
        }
      } else if (step.type === 'transcribe') {
        if (!context.audio) {
          throw new Error('No audio to transcribe. Add an audio input before this step.')
        }
        const model = resolveSttModel(state.settings, step)
        lastModel = model
        emit({ type: 'step:log', index, message: `Transcribing with ${model}` })
        const result = await transcribeAudio({
          blob: context.audio.blob,
          filename: context.audio.name || 'audio.mp3',
          model,
          language: step.language || 'auto',
          prompt: step.prompt || '',
          signal,
          onProgress: (p) =>
            emit({
              type: 'step:progress',
              index,
              stage: 'transcribe',
              percent: p.percent || 0,
              message: p.message || 'Transcribing…',
            }),
        })
        context.transcript = result.text
        context.transcriptModel = model
        context.text = result.text
        usage = addUsage(usage, result.usage)
        emit({ type: 'step:log', index, message: `${wordCount(result.text)} words transcribed` })
      } else if (step.type === 'task') {
        if (!context.text?.trim() && !context.image?.dataUrl) {
          throw new Error('This AI step has no text or image input.')
        }
        const model = resolveTaskModel(state.settings, step)
        lastModel = model
        const isRefine = index === refineStepIndex && Boolean(feedback.trim())
        const messages = buildTaskMessages(step, context, {
          feedback: isRefine ? feedback : '',
          previousOutput: isRefine ? previousOutput : '',
          model,
        })
        emit({ type: 'step:meta', index, model, revising: isRefine })
        emit({
          type: 'step:log',
          index,
          message: isRefine ? `Revising with ${model}` : `Generating with ${model}`,
        })
        const result = await chatStream({
          model,
          messages,
          temperature: clamp(Number(step.temperature ?? state.settings.temperature) || 0, 0, 2),
          maxTokens: Number(state.settings.maxTokens) || 3000,
          signal,
          onDelta: (delta) => emit({ type: 'step:token', index, delta }),
          onUsage: (u) => {
            usage = addUsage(usage, u)
          },
        })
        context.text = result.text
        context.lastTask = {
          output: result.text,
          model,
          usage: result.usage || null,
          at: Date.now(),
        }
      } else if (step.type === 'output') {
        context.output = context.text || context.transcript || ''
        if (!context.output) {
          emit({ type: 'step:log', index, message: 'No text output produced yet.' })
        }
      } else {
        throw new Error(`Unknown step type: ${step.type}`)
      }

      const after = snapshotContext(context)
      const durationMs = Math.round(performance.now() - stepStart)
      snapshots[index] = { before, after }
      const meta = {
        id: step.id,
        type: step.type,
        label: stepLabelFor(step),
        status: 'done',
        durationMs,
        outputPreview: previewFor(step, after),
        model: step.type === 'task' || step.type === 'transcribe' ? lastModel : '',
        error: '',
      }
      stepsMeta[index] = meta
      emit({
        type: 'step:done',
        index,
        step,
        meta,
        after,
        durationMs,
      })
    }

    const contextOut = snapshotContext(context)
    const output = contextOut.output || contextOut.text || ''
    const result = {
      context: contextOut,
      output,
      steps: stepsMeta,
      snapshots,
      usage,
      model: lastModel,
      durationMs: Math.round(performance.now() - startedAt),
    }
    emit({ type: 'run:done', result })
    return result
  } catch (err) {
    if (currentIndex >= 0) {
      const step = flow.steps[currentIndex]
      const durationMs = 0
      stepsMeta[currentIndex] = {
        id: step.id,
        type: step.type,
        label: stepLabelFor(step),
        status: isAbort(err) ? 'cancelled' : 'error',
        durationMs,
        outputPreview: previewFor(step, snapshotContext(context)),
        model: step.type === 'task' || step.type === 'transcribe' ? lastModel : '',
        error: parseError(err),
      }
      if (!snapshots[currentIndex]) {
        snapshots[currentIndex] = {
          before: snapshotContext(context),
          after: snapshotContext(context),
        }
      }
      err.partial = {
        steps: stepsMeta,
        snapshots,
        context: snapshotContext(context),
        errorStep: currentIndex,
        usage,
      }
      emit({
        type: 'step:error',
        index: currentIndex,
        step,
        error: parseError(err),
        meta: stepsMeta[currentIndex],
      })
    }
    emit({ type: 'run:error', error: parseError(err), aborted: isAbort(err) })
    throw err
  }
}

// Re-run from a saved step (refine/redo)
export async function refineRun({ run, stepIndex, feedback = '', onEvent, signal }) {
  const flow = run.flowSnapshot
  if (!flow?.steps?.length) throw new Error('This run has no saved flow.')
  let target = Number.isInteger(stepIndex) ? stepIndex : findLastTaskIndex(flow)
  if (!flow.steps[target] || flow.steps[target].type !== 'task') {
    target = findLastTaskIndex(flow)
  }
  if (target < 0) throw new Error('This flow has no AI task to refine.')

  const before = run.snapshots?.[target]?.before
  if (!before) throw new Error('The saved context for this step is missing. Re-run the flow instead.')

  const contextBefore = hydrateContext(before, run.inputs)
  const previousOutput =
    run.snapshots?.[target]?.after?.lastTask?.output ||
    run.snapshots?.[target]?.after?.text ||
    run.steps?.[target]?.outputPreview ||
    ''

  const result = await runFlow({
    flow,
    inputs: run.inputs,
    startIndex: target,
    baseContext: contextBefore,
    refineStepIndex: target,
    feedback: feedback.trim(),
    previousOutput,
    onEvent,
    signal,
  })

  // Merge untouched earlier steps with the re-run tail.
  const mergedSteps = [...(run.steps || [])]
  const mergedSnapshots = [...(run.snapshots || [])]
  for (let i = target; i < flow.steps.length; i++) {
    if (result.steps[i]) mergedSteps[i] = result.steps[i]
    if (result.snapshots[i]) mergedSnapshots[i] = result.snapshots[i]
  }

  run.steps = mergedSteps
  run.snapshots = mergedSnapshots
  run.context = result.context
  run.output = result.output
  run.outputPreview = truncate(markdownToPlainText(result.output), 280)
  run.status = 'done'
  run.error = ''
  run.updatedAt = Date.now()
  run.durationMs = (run.durationMs || 0) + result.durationMs
  run.usage = addUsage(run.usage, result.usage)
  run.model = result.model || run.model

  const kind = feedback.trim() ? 'refine' : 'redo'
  const version = {
    id: uid('ver'),
    at: Date.now(),
    kind,
    label: kind === 'redo' ? 'Redo' : 'Revision',
    feedback: feedback.trim(),
    output: result.output,
    stepIndex: target,
  }
  run.versions = [...(run.versions || []), version].slice(-16)
  return { run, result, version }
}

export function lastTaskStepIndex(run) {
  return findLastTaskIndex(run?.flowSnapshot)
}

export function makeRunTitle(flow, inputs) {
  const first = String(inputs?.text || inputs?.image?.name || '').trim()
  const base = flow.name || 'Run'
  return first ? `${base} · ${truncate(first, 46)}` : base
}

export function contextImage(run) {
  return run?.inputs?.image?.dataUrl ? run.inputs.image : null
}
