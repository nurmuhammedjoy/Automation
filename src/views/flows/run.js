// Run mode: input form, live step progress, execution, and refine/redo.
import { MAX_DIRECT_AUDIO } from '../../api.js'
import { applyRunError, applyRunResult, createRunRecord, refineRun, runFlow } from '../../engine.js'
import { INPUT_MODES, clone } from '../../data.js'
import { getFlow, state } from '../../store.js'
import { saveRun } from '../../db.js'
import { icon } from '../../icons.js'
import {
  $,
  $$,
  apiKeyBanner,
  emptyState,
  streamingMarkdown,
  toast,
} from '../../components.js'
import { bindRunResult, setRefineBusy, taskStepIndex } from '../../runui.js'
import { esc, formatBytes, prepareImage, shortModelName, truncate, wordCount } from '../../util.js'
import { cacheRun, inputStep, stepIcon, stepTitle } from './shared.js'
import { flowIssues } from './validate.js'

export function inputMode(S) {
  return inputStep(S.flow)?.mode || 'text'
}

function inputValid(S) {
  const mode = inputMode(S)
  if (mode === 'image') return Boolean(S.assets.image)
  if (mode === 'audio') {
    return Boolean(S.assets.audioFile) && S.assets.audioFile.size <= MAX_DIRECT_AUDIO
  }
  return Boolean(S.values.text.trim())
}

function inputHintText(S) {
  const mode = inputMode(S)
  if (mode === 'image') return S.assets.image ? '' : 'Choose an image to run this flow.'
  if (mode === 'audio') {
    if (isRecording(S)) return 'Stop the recording to run this flow.'
    if (!S.assets.audioFile) return 'Choose an audio file to run this flow.'
    if (S.assets.audioFile.size > MAX_DIRECT_AUDIO) return 'Audio is over 24 MB. Export a smaller MP3.'
    return ''
  }
  return S.values.text.trim() ? '' : 'Add text to run this flow.'
}

const RECORD_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

function recorderSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

function recordMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return RECORD_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
}

function recordExtension(mime) {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

function clockLabel(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function isRecording(S) {
  return S.recorder?.recorder?.state === 'recording'
}

function recorderMarkup(S) {
  if (!recorderSupported()) return ''
  const recording = isRecording(S)
  const hasAudio = Boolean(S.assets.audioFile)
  const elapsed = recording ? clockLabel(Date.now() - (S.recorder?.startedAt || Date.now())) : ''
  const title = recording ? 'Recording audio' : hasAudio ? 'Record again' : 'Record audio'
  const sub = recording
    ? 'Tap stop when you are done.'
    : S.busy
      ? 'Wait for the current run to finish.'
      : hasAudio
        ? 'Replaces the current audio with a new take.'
        : 'Use your microphone — no file needed.'
  return `<div class="m-recorder ${recording ? 'is-recording' : ''}" data-recorder>
    <div class="m-recorder-top">
      <span class="m-recorder-orb" aria-hidden="true">${icon(recording ? 'stop' : 'mic', 'size-6')}</span>
      <div class="min-w-0 flex-1">
        <div class="m-recorder-title">${title}</div>
        <div class="m-recorder-sub">${sub}</div>
      </div>
      <span class="m-recorder-time ${recording ? '' : 'hidden'}" data-rec-time role="timer" aria-live="off">${elapsed}</span>
    </div>
    ${
      recording
        ? `<div class="m-recorder-bars" aria-hidden="true">${'<span></span>'.repeat(5)}</div>`
        : ''
    }
    <div class="m-recorder-actions">
      <button type="button" class="m-recorder-btn ${recording ? 'is-stop' : ''}" data-rec-toggle ${S.busy && !recording ? 'disabled' : ''}>
        ${icon(recording ? 'stop' : 'mic', 'size-5')}
        <span>${recording ? 'Stop recording' : hasAudio ? 'Record again' : 'Start recording'}</span>
      </button>
      ${recording ? `<button type="button" class="btn btn-sm btn-ghost" data-rec-cancel>Cancel</button>` : ''}
    </div>
  </div>`
}

function startRecTimer(S) {
  if (!S.recorder) return
  clearInterval(S.recorder.timer)
  const tick = () => {
    if (!S.recorder) return
    const el = $('[data-rec-time]', S.root)
    if (el) el.textContent = clockLabel(Date.now() - S.recorder.startedAt)
  }
  tick()
  S.recorder.timer = setInterval(tick, 500)
}

function stopRecTimer(S) {
  if (S.recorder?.timer) {
    clearInterval(S.recorder.timer)
    S.recorder.timer = 0
  }
}

async function startRecording(S) {
  if (!recorderSupported()) {
    toast('Recording is not available in this browser.', 'error')
    return
  }
  if (S.busy) {
    toast('Wait for the current run to finish.', 'info')
    return
  }
  if (isRecording(S) || S.recorderStarting) return
  S.recorderStarting = true
  let stream = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (S.disposed) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    const mime = recordMime()
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    S.recorder = {
      recorder,
      stream,
      chunks: [],
      startedAt: Date.now(),
      timer: 0,
      discard: false,
    }
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size && S.recorder?.chunks) S.recorder.chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => finishRecording(S))
    recorder.start()
    S.mount({ keepScroll: true })
    startRecTimer(S)
  } catch (err) {
    stream?.getTracks().forEach((track) => track.stop())
    S.recorder = null
    if (S.disposed) return
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
    toast(
      denied
        ? 'Microphone access was denied. Allow it in your browser settings.'
        : 'Could not start recording. Try again.',
      'error',
    )
  } finally {
    S.recorderStarting = false
  }
}

function stopRecording(S) {
  const recorder = S.recorder?.recorder
  if (!recorder || recorder.state === 'inactive') return
  stopRecTimer(S)
  recorder.stop()
}

function cancelRecording(S) {
  if (!S.recorder) return
  S.recorder.discard = true
  if (isRecording(S)) {
    stopRecording(S)
    return
  }
  disposeRecorder(S)
  S.mount({ keepScroll: true })
}

function finishRecording(S) {
  const rec = S.recorder
  if (!rec) return
  stopRecTimer(S)
  rec.stream?.getTracks().forEach((track) => track.stop())
  const chunks = rec.chunks.slice()
  const discard = rec.discard
  S.recorder = null
  if (discard || !chunks.length || S.disposed) {
    if (!S.disposed) S.mount({ keepScroll: true })
    return
  }
  const type = chunks[0]?.type || 'audio/webm'
  const file = new File(chunks, `recording-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${recordExtension(type)}`, {
    type,
  })
  if (file.size > MAX_DIRECT_AUDIO) {
    toast('That recording is over 24 MB. Record a shorter clip.', 'error')
    S.mount({ keepScroll: true })
    return
  }
  if (S.assets.audioUrl) URL.revokeObjectURL(S.assets.audioUrl)
  S.assets.audioFile = file
  S.assets.audioUrl = URL.createObjectURL(file)
  S.assets.audioOrigin = 'record'
  S.mount({ keepScroll: true })
}

export function disposeRecorder(S) {
  const rec = S.recorder
  if (!rec) return
  stopRecTimer(S)
  rec.discard = true
  rec.stream?.getTracks().forEach((track) => track.stop())
  try {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop()
  } catch {
    // The stream is already stopped; nothing else to release.
  }
  S.recorder = null
}

// Input form
export function runMarkup(S, validation) {
  return `<div class="m-group">
    ${apiKeyBanner()}

    ${
      validation.length
        ? `<div class="m-warning"><span class="shrink-0">${icon('alert', 'size-5')}</span><div><strong>Finish the graph first</strong><ul>${validation.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div></div>`
        : ''
    }

    ${
      inputStep(S.flow)
        ? `<section class="card settings-pad">
            <div class="section-head">
              <div class="min-w-0 flex-1">
                <h2>${esc(INPUT_MODES[inputMode(S)]?.label || 'Text')} input</h2>
                <p class="section-sub">${esc(INPUT_MODES[inputMode(S)]?.hint || '')}</p>
              </div>
            </div>
            ${runInputMarkup(S, inputMode(S))}
            <div class="mt-4">
              <button type="button" class="btn btn-primary btn-lg w-full" id="run-flow-btn" ${!inputValid(S) || validation.length || S.busy ? 'disabled' : ''}>
                ${S.busy ? '<span class="spinner"></span> Running…' : `${icon('play', 'size-5')} Run flow`}
              </button>
              <div id="run-hint" class="helper mt-2 text-center">${esc(S.busy ? 'Working on this device…' : inputHintText(S))}</div>
            </div>
          </section>`
        : `<div class="card">${emptyState({
            iconName: 'alert',
            title: 'No input node',
            text: 'Open Build and add an input node first.',
            action: `<a href="#flows/${esc(S.flow.id)}" class="btn btn-sm btn-tonal mt-1">${icon('flows', 'size-4')} Open graph</a>`,
          })}</div>`
    }
  </div>`
}

function runInputMarkup(S, mode) {
  if (mode === 'image') {
    return `<div class="mt-4">
      ${
        S.assets.image
          ? `<div class="overflow-hidden rounded-xl bg-panel2">
              <img src="${esc(S.assets.image.dataUrl)}" alt="Selected image" class="max-h-64 w-full object-contain" />
              <div class="flex items-center gap-2 border-t border-line px-3 py-2.5">
                <span class="min-w-0 flex-1 truncate text-[12px] text-muted">${esc(S.assets.image.name)} · ${formatBytes(S.assets.image.size)}</span>
                <button type="button" class="btn btn-xs btn-ghost" data-clear-image>${icon('close', 'size-3')} Remove</button>
              </div>
            </div>`
          : `<label class="file-drop" data-drop="image" for="flow-file-image">
              ${icon('image', 'size-7 text-accent')}
              <span class="text-[13px] font-medium text-text">Choose an image</span>
              <span class="text-[12px] text-faint">Photo, screenshot, or document</span>
              <input id="flow-file-image" type="file" accept="image/*" class="sr-only" />
            </label>`
      }
    </div>
    <textarea id="flow-input-text" class="textarea textarea-sm mt-3" rows="2" placeholder="Optional note for the model…">${esc(S.values.text)}</textarea>`
  }

  if (mode === 'audio') {
    const recorder = recorderMarkup(S)
    return `<div class="mt-4">
      ${recorder}
      ${
        S.assets.audioFile
          ? `<div class="mt-3 rounded-xl bg-panel2 p-3">
              <div class="flex items-center gap-3">
                <span class="graph-node-icon" data-kind="transcribe">${icon('audio', 'size-4')}</span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 truncate text-[13px] font-medium">${S.assets.audioOrigin === 'record' ? 'Recorded audio' : esc(S.assets.audioFile.name)}</span>
                    ${S.assets.audioOrigin === 'record' ? `<span class="m-rec-chip">${icon('mic', 'size-3')} Recorded</span>` : ''}
                  </div>
                  <div class="text-[12px] text-faint">${formatBytes(S.assets.audioFile.size)}</div>
                </div>
                <button type="button" class="btn btn-xs btn-ghost" data-clear-audio>${icon('close', 'size-3')} Remove</button>
              </div>
              <audio class="mt-3 w-full" controls preload="metadata" src="${esc(S.assets.audioUrl)}"></audio>
            </div>`
          : `${recorder ? '<div class="m-rec-divider"><span>or choose a file</span></div>' : ''}
            <label class="file-drop" data-drop="audio" for="flow-file-audio">
              ${icon('upload', 'size-7 text-accent')}
              <span class="text-[13px] font-medium text-text">Choose an audio file</span>
              <span class="text-[12px] text-faint">mp3, m4a, wav, ogg, webm · up to 24 MB</span>
              <input id="flow-file-audio" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4" class="sr-only" />
            </label>
            <p class="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-faint">${icon('info', 'size-3.5 mt-0.5 shrink-0')} Export a mono MP3 at 64–96 kbps if your recording is over 24 MB.</p>`
      }
      ${
        S.assets.audioFile && S.assets.audioFile.size > MAX_DIRECT_AUDIO
          ? `<p class="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-warn">${icon('alert', 'size-3.5 mt-0.5 shrink-0')} Audio is over 24 MB. Export a smaller MP3 (64–96 kbps) and try again.</p>`
          : ''
      }
    </div>`
  }

  return `<div class="mt-4">
    <div class="mb-1.5 flex items-center justify-between">
      <label class="label mb-0" for="flow-input-text">Text</label>
      <span id="flow-word-count" class="text-[12px] tabular-nums text-faint">${wordCount(S.values.text)} words</span>
    </div>
    <textarea id="flow-input-text" class="textarea" rows="6" placeholder="${esc(inputStep(S.flow)?.placeholder || 'Paste or type text…')}">${esc(S.values.text)}</textarea>
  </div>`
}

export function bindRun(S) {
  const refresh = () => {
    const btn = $('#run-flow-btn', S.root)
    if (btn) btn.disabled = S.busy || isRecording(S) || !inputValid(S) || flowIssues(S.flow).length > 0
    const hint = $('#run-hint', S.root)
    if (hint) hint.textContent = inputHintText(S)
  }
  $('#flow-input-text', S.root)?.addEventListener('input', (e) => {
    S.values.text = e.target.value
    const count = $('#flow-word-count', S.root)
    if (count) count.textContent = `${wordCount(S.values.text)} words`
    S.queueDraft()
    refresh()
  })
  $('#flow-file-image', S.root)?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (file) await pickImage(S, file)
  })
  $('#flow-file-audio', S.root)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0]
    if (file) pickAudio(S, file)
  })
  $('[data-rec-toggle]', S.root)?.addEventListener('click', () => {
    if (isRecording(S)) stopRecording(S)
    else startRecording(S)
  })
  $('[data-rec-cancel]', S.root)?.addEventListener('click', () => cancelRecording(S))
  if (isRecording(S)) startRecTimer(S)
  $$('[data-clear-image]', S.root).forEach((b) =>
    b.addEventListener('click', () => {
      S.assets.image = null
      S.mount({ keepScroll: true })
    }),
  )
  $$('[data-clear-audio]', S.root).forEach((b) =>
    b.addEventListener('click', () => {
      if (S.assets.audioUrl) URL.revokeObjectURL(S.assets.audioUrl)
      S.assets.audioFile = null
      S.assets.audioUrl = ''
      S.assets.audioOrigin = ''
      S.mount({ keepScroll: true })
    }),
  )
  bindDropZone(S, 'image', (file) => pickImage(S, file))
  bindDropZone(S, 'audio', (file) => pickAudio(S, file))
  $('#run-flow-btn', S.root)?.addEventListener('click', () => startRun(S))
}

function bindDropZone(S, kind, onFile) {
  const zone = $(`[data-drop="${kind}"]`, S.root)
  if (!zone) return
  const stop = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }
  zone.addEventListener('dragover', (e) => {
    stop(e)
    zone.style.borderColor = 'var(--accent)'
  })
  zone.addEventListener('dragleave', (e) => {
    stop(e)
    zone.style.borderColor = ''
  })
  zone.addEventListener('drop', (e) => {
    stop(e)
    zone.style.borderColor = ''
    const file = e.dataTransfer?.files?.[0]
    if (file) onFile(file)
  })
}

async function pickImage(S, file) {
  try {
    S.assets.image = await prepareImage(file)
    S.mount({ keepScroll: true })
  } catch (err) {
    toast(err.message || 'Could not read that image.', 'error')
  }
}

function pickAudio(S, file) {
  if (S.assets.audioUrl) URL.revokeObjectURL(S.assets.audioUrl)
  S.assets.audioFile = file
  S.assets.audioUrl = URL.createObjectURL(file)
  S.assets.audioOrigin = 'upload'
  S.mount({ keepScroll: true })
}

function gatherInputs(S) {
  return {
    text: S.values.text,
    image: S.assets.image,
    audioFile: S.assets.audioFile,
  }
}

function runTitle(S) {
  const mode = inputMode(S)
  if (mode === 'image') return `${S.flow.name}${S.assets.image ? ` · ${S.assets.image.name}` : ''}`
  if (mode === 'audio') {
    if (!S.assets.audioFile) return S.flow.name
    const label = S.assets.audioOrigin === 'record' ? 'Recording' : S.assets.audioFile.name
    return `${S.flow.name} · ${label}`
  }
  return `${S.flow.name}${S.values.text ? ` · ${truncate(S.values.text, 40)}` : ''}`
}

function ensureReady(S) {
  if (!state.settings.apiKey) {
    toast('Add a Groq API key in Settings first.', 'info')
    location.hash = '#settings'
    return false
  }
  if (flowIssues(S.flow).length) {
    toast('Finish the graph first.', 'info')
    return false
  }
  if (!inputValid(S)) {
    toast(inputHintText(S) || 'Add an input first.', 'info')
    return false
  }
  return true
}

// Execution
async function startRun(S) {
  if (isRecording(S)) {
    toast('Stop the recording to run this flow.', 'info')
    return
  }
  if (S.recorderStarting) {
    toast('Wait for microphone access first.', 'info')
    return
  }
  if (S.busy || !ensureReady(S)) return
  S.flushDraft()
  const snapshot = getFlow(S.flow.id)
  if (!snapshot) return
  const record = createRunRecord({
    flow: clone(snapshot),
    inputs: gatherInputs(S),
    title: runTitle(S),
    icon: snapshot.icon,
  })
  await execute(S, snapshot, gatherInputs(S), record)
}

async function execute(S, runFlowDef, inputs, record) {
  S.activeRun = record
  S.selectedVersionId = ''
  S.lastFlow = runFlowDef
  S.lastInputs = inputs
  S.busy = true
  S.controller = new AbortController()
  renderLive(S, runFlowDef)
  const btn = $('#run-flow-btn', S.root)
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Running…'
  }
  const hint = $('#run-hint', S.root)
  if (hint) hint.textContent = 'Working on this device…'
  requestAnimationFrame(() => $('#run-area', S.root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  let streamer = null
  let streamIndex = -1
  const outputEl = $('#live-output', S.root)
  const outputWrap = $('#live-output-wrap', S.root)

  const onEvent = (evt) => {
    if (S.disposed) return
    const row = evt.index != null ? $(`[data-live-row="${evt.index}"]`, S.root) : null
    const status = $('#live-status', S.root)
    if (evt.type === 'step:start') {
      if (status) status.textContent = `Step ${evt.index + 1} of ${runFlowDef.steps.length} · ${evt.label}`
      if (row) {
        row.dataset.state = 'running'
        $('[data-live-dot]', row)?.setAttribute('data-state', 'running')
        const msg = $('[data-live-msg]', row)
        if (msg) msg.textContent = 'Working…'
      }
      if (evt.step.type === 'task') {
        streamer?.cancel()
        streamer = outputEl ? streamingMarkdown(outputEl) : null
        streamIndex = evt.index
        if (outputEl) outputEl.innerHTML = ''
        outputWrap?.classList.remove('hidden')
      }
    } else if (evt.type === 'step:progress') {
      if (row) {
        const msg = $('[data-live-msg]', row)
        if (msg) msg.textContent = [evt.message, evt.percent ? `${Math.round(evt.percent)}%` : ''].filter(Boolean).join(' · ') || 'Working…'
        const bar = $('[data-live-bar]', row)
        if (bar) bar.style.width = `${Math.max(3, Math.min(100, Number(evt.percent) || 0))}%`
      }
    } else if (evt.type === 'step:log') {
      if (row) {
        const msg = $('[data-live-msg]', row)
        if (msg) msg.textContent = evt.message
      }
    } else if (evt.type === 'step:meta') {
      if (row) {
        const badge = $('[data-live-model]', row)
        if (badge) {
          badge.textContent = shortModelName(evt.model)
          badge.classList.remove('hidden')
        }
      }
    } else if (evt.type === 'step:token') {
      if (evt.index !== streamIndex && outputEl) {
        streamer?.cancel()
        streamer = streamingMarkdown(outputEl)
        streamIndex = evt.index
        outputEl.innerHTML = ''
        outputWrap?.classList.remove('hidden')
      }
      streamer?.push(evt.delta)
    } else if (evt.type === 'step:done') {
      if (row) {
        row.dataset.state = 'done'
        $('[data-live-dot]', row)?.setAttribute('data-state', 'done')
        const bar = $('[data-live-bar]', row)
        if (bar) bar.style.width = '100%'
        const msg = $('[data-live-msg]', row)
        if (msg) msg.textContent = evt.meta?.outputPreview || 'Done'
      }
      if (evt.step.type === 'task') streamer?.finish()
    } else if (evt.type === 'step:error') {
      if (row) {
        row.dataset.state = 'error'
        $('[data-live-dot]', row)?.setAttribute('data-state', 'error')
        const msg = $('[data-live-msg]', row)
        if (msg) msg.textContent = evt.error
      }
    }
  }

  try {
    const result = await runFlow({ flow: runFlowDef, inputs, signal: S.controller.signal, onEvent })
    streamer?.finish()
    applyRunResult(record, result)
    await persistRun(S, record)
    cacheRun(record)
    S.busy = false
    S.controller = null
    if (S.disposed) return
    S.mount({ keepScroll: true, scrollTo: 'result' })
    toast('Run complete', 'success', 1500)
  } catch (err) {
    streamer?.cancel()
    if (S.disposed) return
    applyRunError(record, err)
    S.busy = false
    S.controller = null
    if (record.status === 'cancelled') {
      await persistRun(S, record)
      S.mount({ keepScroll: true })
      toast('Run stopped', 'info')
      return
    }
    await persistRun(S, record)
    cacheRun(record)
    S.mount({ keepScroll: true, scrollTo: 'result' })
    toast(err.message || 'The run failed', 'error', 5000)
  }
}

async function persistRun(S, record) {
  try {
    await saveRun(record, Number(state.settings.keepRuns) || 40)
  } catch (err) {
    toast(`Run finished, but history could not be saved: ${err.message}`, 'error', 4000)
  }
}

async function retryRun(S) {
  if (S.busy) return
  if (!state.settings.apiKey) {
    location.hash = '#settings'
    return
  }
  const flowDef = S.lastFlow || S.activeRun?.flowSnapshot
  if (!flowDef) return
  const inputs = S.lastInputs || gatherInputs(S)
  if (inputMode(S) === 'image' && !inputs.image) {
    toast('Re-select the image first.', 'info')
    return
  }
  if (inputMode(S) === 'audio' && !inputs.audioFile) {
    toast('Re-select the audio file first.', 'info')
    return
  }
  const record = createRunRecord({ flow: flowDef, inputs, title: runTitle(S), icon: S.flow.icon })
  await execute(S, flowDef, inputs, record)
}

// Result view, refine & retry
export function bindResult(S) {
  const area = $('#run-area', S.root)
  if (!area) return
  bindRunResult(area, S.activeRun, {
    onVersionChange: (id) => {
      S.selectedVersionId = id || ''
      S.mount({ keepScroll: true })
    },
    onRetry: () => retryRun(S),
  })
  $('[data-apply-refine]', area)?.addEventListener('click', () => {
    const feedback = $('[data-refine-input]', area)?.value?.trim() || ''
    if (!feedback) {
      toast('Describe what you want changed first.', 'info')
      return
    }
    runRefinement(S, feedback)
  })
  $('[data-redo]', area)?.addEventListener('click', () => runRefinement(S, ''))
  $('[data-stop-run]', area)?.addEventListener('click', () => S.controller?.abort())
}

async function runRefinement(S, feedback) {
  if (S.busy || !S.activeRun || S.activeRun.status !== 'done') return
  if (!state.settings.apiKey) {
    toast('Add a Groq API key in Settings.', 'info')
    return
  }
  const target = taskStepIndex(S.activeRun)
  if (target < 0) {
    toast('This flow has no refinable AI step.', 'info')
    return
  }
  const area = $('#run-area', S.root)
  const preview = $('[data-refine-preview]', area)
  S.busy = true
  S.controller = new AbortController()
  setRefineBusy(area, true, feedback ? 'Revising…' : 'Redoing…')
  preview?.classList.remove('hidden')
  if (preview) preview.innerHTML = ''
  const streamer = preview ? streamingMarkdown(preview) : null

  try {
    const { run } = await refineRun({
      run: S.activeRun,
      stepIndex: target,
      feedback,
      signal: S.controller.signal,
      onEvent: (evt) => {
        if (S.disposed) return
        if (evt.type === 'step:token') streamer?.push(evt.delta)
        if (evt.type === 'step:progress' && evt.message) {
          const el = $('[data-refine-status-text]', area)
          if (el) el.textContent = evt.message
        }
        if (evt.type === 'step:meta') {
          const el = $('[data-refine-status-text]', area)
          if (el) el.textContent = `${evt.revising ? 'Revising' : 'Running'} with ${shortModelName(evt.model)}…`
        }
      },
    })
    streamer?.finish()
    S.activeRun = run
    cacheRun(run)
    S.selectedVersionId = ''
    S.busy = false
    S.controller = null
    await persistRun(S, S.activeRun)
    if (S.disposed) return
    S.mount({ keepScroll: true, scrollTo: 'result' })
    toast(feedback ? 'Revision saved' : 'New version ready', 'success', 1600)
  } catch (err) {
    streamer?.cancel()
    if (S.disposed) return
    S.busy = false
    S.controller = null
    S.mount({ keepScroll: true })
    toast(err.name === 'AbortError' ? 'Stopped' : err.message || 'Refinement failed', err.name === 'AbortError' ? 'info' : 'error', 4000)
  }
}

// Live step progress
function renderLive(S, runFlowDef) {
  const area = $('#run-area', S.root)
  if (!area) return
  const rows = runFlowDef.steps
    .map((step, i) => {
      const label = stepTitle(step)
      return `<div class="live-row" data-live-row="${i}" data-state="pending">
        <span class="graph-node-icon mt-0.5" data-kind="${esc(step.type)}">${icon(stepIcon(step), 'size-4')}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-[14px] font-medium">${esc(label)}</span>
            <span class="badge hidden" data-live-model></span>
            <span class="dot ml-auto shrink-0" data-state="pending" data-live-dot></span>
          </div>
          <div class="mt-0.5 text-[12px] leading-5 text-muted"><span data-live-msg>Waiting…</span></div>
          <div class="live-progress"><div data-live-bar></div></div>
        </div>
      </div>`
    })
    .join('')
  area.innerHTML = `<section class="card">
    <div class="live-head">
      <span class="spinner text-accent"></span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[16px] font-medium">Running ${esc(runFlowDef.name)}</div>
        <div id="live-status" class="helper">Starting…</div>
      </div>
      <button type="button" class="btn btn-sm btn-danger" id="live-stop">${icon('stop', 'size-4')} Stop</button>
    </div>
    <div>${rows}</div>
    <div id="live-output-wrap" class="hidden px-4 pb-4">
      <div class="mb-2 mt-1 flex items-center gap-2 text-[12px] font-medium text-muted"><span class="dot" data-state="running"></span> Live output</div>
      <div id="live-output" class="markdown rounded-xl bg-panel2 p-3"></div>
    </div>
  </section>`
  $('#live-stop', S.root)?.addEventListener('click', () => {
    const btn = $('#live-stop', S.root)
    if (btn) {
      btn.disabled = true
      btn.innerHTML = '<span class="spinner"></span> Stopping…'
    }
    S.controller?.abort()
  })
}
