// Static data: default flows, step types, model roles, and step factories.
import { isVisionModel, uid } from './util.js'

export const STORAGE_KEY = 'modu.state.v3'
export const MODELS_KEY = 'modu.models.v3'

export const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.groq.com/openai/v1',
  models: {
    smart: 'openai/gpt-oss-120b',
    vision: 'qwen/qwen3.8-27b',
    stt: 'whisper-large-v3-turbo',
  },
  accent: 'default',
  temperature: 0.35,
  maxTokens: 3000,
  keepRuns: 40,
  installHintDismissed: false,
}

export const MODEL_ROLE_META = {
  smart: { label: 'Smart', hint: 'Best quality for most tasks' },
  vision: { label: 'Vision', hint: 'Reads images and screenshots' },
  stt: { label: 'Speech → text', hint: 'Fast transcription' },
}

export const FALLBACK_MODELS = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', kind: 'text' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', kind: 'text' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', kind: 'vision' },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', kind: 'text' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', kind: 'text' },
  { id: 'whisper-large-v3-turbo', label: 'Whisper Turbo', kind: 'stt' },
  { id: 'whisper-large-v3', label: 'Whisper Large v3', kind: 'stt' },
]

export const INPUT_MODES = {
  text: { label: 'Text', icon: 'text', hint: 'Type or paste text' },
  image: { label: 'Image', icon: 'image', hint: 'Import a photo or screenshot' },
  audio: { label: 'Audio file', icon: 'audio', hint: 'Import a recording' },
}

export const STT_LANGUAGES = [
  ['auto', 'Auto-detect'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['tr', 'Turkish'],
  ['pl', 'Polish'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
]

export const STEP_META = {
  input: {
    label: 'Input',
    icon: 'text',
    short: 'What goes into the flow',
    hint: 'Choose what you will provide when running the flow.',
  },
  transcribe: {
    label: 'Speech to text',
    icon: 'mic',
    short: 'Turn audio into a transcript',
    hint: 'Transcribes an uploaded audio file with Groq Whisper.',
  },
  task: {
    label: 'AI task',
    icon: 'sparkles',
    short: 'Pre-prompted model step',
    hint: 'Give the model an instruction and a prompt. It receives the previous step as input.',
  },
  output: {
    label: 'Output',
    icon: 'check',
    short: 'The result you keep',
    hint: 'Mark the end of the flow. You can refine the output afterwards.',
  },
}

const outStep = () => ({ id: uid('st'), type: 'output', label: 'Output' })

function seedFlow({ id, name, description, icon, steps }) {
  const now = Date.now()
  return {
    id,
    name,
    description,
    icon,
    builtIn: true,
    createdAt: now,
    updatedAt: now,
    steps,
  }
}

// Default flow templates
export const DEFAULT_FLOWS = [
  seedFlow({
    id: 'flow-improve-en',
    name: 'Improve English',
    description: 'Input text → polished English → output.',
    icon: 'edit',
    steps: [
      { id: uid('st'), type: 'input', mode: 'text', label: 'Text to improve', placeholder: 'Paste or type your text…' },
      {
        id: uid('st'),
        type: 'task',
        name: 'Polish English',
        category: 'text',
        useImage: false,
        system:
          "You are a meticulous English editor. Improve grammar, spelling, punctuation, clarity, and natural phrasing while preserving the writer's meaning, tone, and level of formality. Do not add new facts, commentary, or explanations.",
        instruction:
          'Rewrite the text below in clear, natural English. Return only the improved text, with no preamble and no notes.',
        temperature: 0.25,
        model: '',
      },
      outStep(),
    ],
  }),
  seedFlow({
    id: 'flow-image-ocr',
    name: 'Image → Text (OCR)',
    description: 'Import a screenshot or document and extract its text.',
    icon: 'image',
    steps: [
      { id: uid('st'), type: 'input', mode: 'image', label: 'Image', placeholder: 'Optional note about the image…' },
      {
        id: uid('st'),
        type: 'task',
        name: 'Extract text',
        category: 'image',
        useImage: true,
        system:
          'You are an accurate OCR and document extraction assistant. Transcribe text exactly, preserving reading order, line breaks, and formatting where possible. Do not translate or embellish.',
        instruction:
          'Extract all visible text from the image. Preserve headings, lists, tables, and line breaks as closely as possible. Return only the extracted text.',
        temperature: 0.1,
        model: '',
      },
      outStep(),
    ],
  }),
  seedFlow({
    id: 'flow-audio-transcript',
    name: 'Audio → Transcript',
    description: 'Keep the raw transcript of a recording, as-is. No AI step.',
    icon: 'mic',
    steps: [
      { id: uid('st'), type: 'input', mode: 'audio', label: 'Audio file', placeholder: '' },
      { id: uid('st'), type: 'transcribe', model: '', language: 'auto', prompt: '' },
      outStep(),
    ],
  }),
  seedFlow({
    id: 'flow-audio-notes',
    name: 'Audio → Notes',
    description: 'Import a recording, transcribe it, and organize the result.',
    icon: 'mic',
    steps: [
      { id: uid('st'), type: 'input', mode: 'audio', label: 'Audio file', placeholder: '' },
      { id: uid('st'), type: 'transcribe', model: '', language: 'auto', prompt: '' },
      {
        id: uid('st'),
        type: 'task',
        name: 'Organize notes',
        category: 'audio',
        useImage: false,
        system:
          'You turn spoken transcripts into accurate, structured notes. Preserve names, numbers, and decisions. Never invent details.',
        instruction:
          'Turn the transcript below into clean notes: a two-sentence overview, then sections with bullets, then action items if any were mentioned.',
        temperature: 0.3,
        model: '',
      },
      outStep(),
    ],
  }),
]

// Helpers & step factories
export function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

export function resolveTaskModel(settings, step) {
  if (step?.model) return step.model
  if (step?.useImage === true) return settings.models.vision
  if (step?.useImage === undefined && step?.category === 'image') return settings.models.vision
  return settings.models.smart
}

/**
 * The input type decides image usage for every AI task. Image flows attach the
 * image automatically and drop text-only pinned models; text/audio flows clear
 * the derived image flag, including after an input type change.
 */
export function syncImageInputTasks(flow) {
  if (!flow || !Array.isArray(flow.steps)) return flow
  const input = flow.steps.find((step) => step.type === 'input')
  const imageFlow = input?.mode === 'image'
  let changed = false

  const steps = flow.steps.map((step) => {
    if (step.type !== 'task') return step
    const category = imageFlow ? 'image' : 'text'
    const badModel = imageFlow && step.model && !isVisionModel(step.model)
    if (step.useImage === imageFlow && step.category === category && !badModel) return step
    changed = true
    const next = { ...step, useImage: imageFlow, category }
    if (badModel) next.model = ''
    return next
  })

  return changed ? { ...flow, steps } : flow
}

export function resolveSttModel(settings, step) {
  if (step?.model) return step.model
  return settings.models.stt
}

export function stepLabel(step) {
  if (step.type === 'task') return step.name || 'AI task'
  return STEP_META[step.type]?.label || step.type
}

export function stepSummary(step) {
  switch (step.type) {
    case 'input':
      return `Input · ${INPUT_MODES[step.mode]?.label || 'Text'}`
    case 'transcribe':
      return 'Speech to text'
    case 'task':
      return stepLabel(step)
    case 'output':
      return 'Output'
    default:
      return step.type
  }
}

export function flowSummary(flow) {
  return flow.steps
    .filter((s) => s.type !== 'output')
    .map((s) => stepSummary(s).replace(' · ', ' '))
    .join(' → ')
}

export function createTaskStep(overrides = {}) {
  return {
    id: uid('st'),
    type: 'task',
    name: 'AI task',
    category: 'text',
    useImage: false,
    system: "You are a helpful assistant. Follow the user's instruction precisely.",
    instruction:
      'Do the task described by the user. If the request is ambiguous, make a sensible assumption and state it briefly.',
    temperature: 0.4,
    model: '',
    ...overrides,
  }
}

export function createFlow() {
  const now = Date.now()
  const task = createTaskStep()
  return {
    id: uid('flow'),
    name: 'New flow',
    description: '',
    icon: 'flows',
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    steps: [
      { id: uid('st'), type: 'input', mode: 'text', label: 'Input', placeholder: '' },
      task,
      { id: uid('st'), type: 'output', label: 'Output' },
    ],
  }
}

export function newWorkflowStep(type) {
  switch (type) {
    case 'input':
      return { id: uid('st'), type, mode: 'text', label: 'Input', placeholder: '' }
    case 'transcribe':
      return { id: uid('st'), type, model: '', language: 'auto', prompt: '' }
    case 'task':
      return createTaskStep()
    case 'output':
      return { id: uid('st'), type, label: 'Output' }
    default:
      return { id: uid('st'), type: 'task', ...createTaskStep() }
  }
}


