/**
 * Temporary DOM smoke test. Not shipped with the app.
 * Run with: node scripts/smoke.mjs
 */
import { Window } from 'happy-dom'

const window = new Window({ url: 'http://127.0.0.1:5173/#flows' })
window.document.body.innerHTML = `
  <main id="view"></main>
  <div id="modal-root"></div>
  <div id="toast-root"></div>
`

globalThis.window = window
globalThis.document = window.document
globalThis.localStorage = window.localStorage
globalThis.sessionStorage = window.sessionStorage
globalThis.HTMLElement = window.HTMLElement
globalThis.HTMLInputElement = window.HTMLInputElement
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.CustomEvent = window.CustomEvent
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.File = window.File
globalThis.FileReader = window.FileReader
globalThis.Blob = window.Blob || globalThis.Blob
globalThis.FormData = window.FormData || globalThis.FormData
globalThis.indexedDB = window.indexedDB
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
})
Object.defineProperty(globalThis, 'location', {
  value: window.location,
  configurable: true,
  writable: true,
})
globalThis.self = window
window.matchMedia =
  window.matchMedia ||
  (() => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
globalThis.matchMedia = window.matchMedia
window.HTMLElement.prototype.scrollIntoView =
  window.HTMLElement.prototype.scrollIntoView || function scrollIntoView() {}
window.scrollTo = window.scrollTo || (() => {})
globalThis.requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) || ((cb) => setTimeout(() => cb(performance.now()), 0))
globalThis.cancelAnimationFrame =
  window.cancelAnimationFrame?.bind(window) || ((id) => clearTimeout(id))

// Network stub: the smoke test exercises the real API code without sending requests.
function mockJson(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url.includes('/audio/transcriptions')) {
    return mockJson({
      text: 'This is a mocked transcription that is long enough to exercise the audio pipeline and keep the workflow moving.',
      usage: { seconds: 62 },
    })
  }
  if (url.includes('/models')) {
    return mockJson({ data: [] })
  }
  return mockJson({
    choices: [{ message: { content: 'Test result\n\n- First point\n- Second point' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  })
}

const errors = []
const origError = console.error
console.error = (...args) => {
  errors.push(args.join(' '))
  origError(...args)
}

function section(name) {
  console.log(`\n— ${name}`)
}

function assert(cond, message) {
  if (!cond) {
    errors.push(`ASSERT: ${message}`)
    console.log(`  ✗ ${message}`)
  } else {
    console.log(`  ✓ ${message}`)
  }
}

async function waitFor(predicate, timeout = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return null
}

localStorage.clear()

section('loading modules')
const store = await import('../src/store.js')
const engine = await import('../src/engine.js')
const { renderFlows } = await import('../src/views/flows/index.js')
const { renderRuns } = await import('../src/views/runs.js')
const { renderSettings } = await import('../src/views/settings.js')
const { modelOptionsData } = await import('../src/components.js')
assert(store.state.flows.length >= 4, 'default flows loaded')

section('settings view')
const settingsRoot = document.createElement('div')
document.body.append(settingsRoot)
const settingsCleanup = renderSettings(settingsRoot)
assert(settingsRoot.textContent.includes('Groq connection'), 'API key card renders')
assert(!settingsRoot.textContent.includes('Local helper'), 'local helper UI is gone')
assert(settingsRoot.querySelectorAll('[data-model-role]').length === 3, 'all three model roles render')
assert(settingsRoot.querySelector('#model-vision'), 'vision select exists')
assert(settingsRoot.querySelector('[data-reset]'), 'final data controls render')
assert(
  modelOptionsData('', { kind: 'vision', includeDefault: false }).some((o) => o.value?.includes('qwen')),
  'vision model option present',
)
assert(!settingsRoot.querySelector('[data-demo-toggle]'), 'demo mode is gone')
const temp = settingsRoot.querySelector('#temperature')
temp.value = '0.9'
temp.dispatchEvent(new window.Event('input'))
assert(Math.abs(store.state.settings.temperature - 0.9) < 0.001, 'temperature updates state')
assert(!settingsRoot.querySelector('[data-theme]'), 'light mode is gone')
settingsRoot.querySelector('[data-accent="ocean"]').click()
assert(store.state.settings.accent === 'ocean', 'accent updates state')
assert(document.documentElement.style.getPropertyValue('--primary'), 'accent palette applies')
settingsRoot.querySelector('[data-accent="default"]').click()
assert(store.state.settings.accent === 'default', 'accent resets to default')
settingsCleanup()

section('flows list')
const flowsRoot = document.createElement('div')
document.body.append(flowsRoot)
const flowsCleanup = renderFlows(flowsRoot, { parts: [] })
assert(flowsRoot.textContent.includes('Audio → Notes'), 'flow template listed')
assert(flowsRoot.querySelectorAll('[data-flow-card]').length >= 4, 'flow cards render')
flowsCleanup()

section('flow builder')
const buildRoot = document.createElement('div')
document.body.append(buildRoot)
const buildCleanup = renderFlows(buildRoot, { parts: ['flow-audio-notes'] })
assert(buildRoot.querySelector('#flow-name'), 'flow name field renders')
assert(buildRoot.querySelectorAll('.graph-node').length >= 4, 'visual graph nodes render')
assert(buildRoot.textContent.includes('Speech to text'), 'speech-to-text step renders')
assert(
  !store.state.flows.some((flow) =>
    flow.steps.some((step) => ['youtube', 'fetchAudio', 'linkAudio'].includes(step.type)),
  ),
  'legacy link steps are absent',
)
assert(buildRoot.querySelector('[data-add-at]'), 'add-step control renders between nodes')
const flowBefore = store.getFlow('flow-audio-notes')
const stepsBefore = flowBefore.steps.length
buildRoot.querySelector('[data-add-at]').click()
document.querySelector('#modal-root [data-module="task"]')?.click()
await waitFor(() => document.querySelector('#modal-root [data-save-step]'))
document.querySelector('#modal-root [data-cancel]')?.click()
await waitFor(() => store.getFlow('flow-audio-notes').steps.length === stepsBefore)
assert(
  store.getFlow('flow-audio-notes').steps.length === stepsBefore,
  'cancelling a new step leaves the flow unchanged',
)
buildCleanup()

section('flow runner')
const runRoot = document.createElement('div')
document.body.append(runRoot)
const runCleanup = renderFlows(runRoot, { parts: ['flow-improve-en', 'run'] })
assert(runRoot.querySelector('#flow-input-text'), 'runner input renders')
assert(runRoot.querySelector('#run-flow-btn'), 'runner button renders')
const flowInput = runRoot.querySelector('#flow-input-text')
flowInput.value = 'this are a test'
flowInput.dispatchEvent(new window.Event('input'))
await new Promise((resolve) => setTimeout(resolve, 20))
store.setSettings({ apiKey: 'test-key' })
runRoot.querySelector('#run-flow-btn').click()
await waitFor(() => runRoot.querySelector('[data-run-result]'), 12000)
assert(runRoot.querySelector('[data-run-result]'), 'flow run completes')
assert(runRoot.textContent.includes('Test result'), 'flow output is rendered')
runCleanup()

section('runs view (no IndexedDB required)')
const runsRoot = document.createElement('div')
document.body.append(runsRoot)
const runsCleanup = renderRuns(runsRoot, { parts: [] })
await new Promise((resolve) => setTimeout(resolve, 60))
assert(runsRoot.textContent.includes('Runs'), 'runs view renders')
assert(runsRoot.querySelector('.m-search #run-search'), 'search field uses the icon-safe wrapper')
runsCleanup()

section('engine run + refine')
store.setSettings({ apiKey: 'test-key', temperature: 0.2 })
const flow = {
  id: 'test-text',
  name: 'Text test',
  steps: [
    { id: 't1', type: 'input', mode: 'text' },
    {
      id: 't2',
      type: 'task',
      name: 'Summarize',
      category: 'text',
      useImage: false,
      system: 'Summarize.',
      instruction: 'Summarize.',
      temperature: 0.2,
      model: '',
    },
    { id: 't3', type: 'output' },
  ],
}
const record = engine.createRunRecord({ flow, inputs: { text: 'One. Two. Three. Four. Five.' } })
const result = await engine.runFlow({
  flow,
  inputs: { text: 'One. Two. Three. Four. Five.' },
  onEvent: () => {},
})
engine.applyRunResult(record, result)
assert(result.output.includes('Test result'), 'run produces output')
assert(record.versions.length === 1, 'initial version recorded')
const refined = await engine.refineRun({
  run: record,
  stepIndex: engine.lastTaskStepIndex(record),
  feedback: 'Make it shorter',
  onEvent: () => {},
})
assert(refined.version.kind === 'refine', 'refinement adds a revision')
assert(refined.run.versions.length === 2, 'two versions after refinement')
assert(refined.run.output.length > 0, 'refined output exists')

section('transcription')
const transcribeFlow = {
  id: 'test-audio',
  name: 'Audio test',
  steps: [
    { id: 's1', type: 'input', mode: 'audio' },
    { id: 's2', type: 'transcribe', model: '', language: 'auto', prompt: '' },
    {
      id: 's3',
      type: 'task',
      name: 'Summarize',
      category: 'audio',
      useImage: false,
      system: 'Summarize.',
      instruction: 'Summarize.',
      temperature: 0.2,
      model: '',
    },
    { id: 's4', type: 'output' },
  ],
}
const fakeAudio = new File([new Uint8Array(1024)], 'fake.mp3', { type: 'audio/mpeg' })
const audioResult = await engine.runFlow({
  flow: transcribeFlow,
  inputs: { audioFile: fakeAudio },
  onEvent: () => {},
})
assert(audioResult.context.transcript.length > 20, 'transcript produced')
assert(audioResult.output.includes('Test result'), 'audio task produces output')

section('result')
if (errors.length) {
  console.log(`\n${errors.length} problem(s):`)
  for (const err of errors) console.log(` · ${err}`)
  process.exit(1)
}
console.log('\n✓ UI smoke test passed')
