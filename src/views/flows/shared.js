// Flow-view helpers: step icons/titles, input/output lookup, last-run cache.
import { INPUT_MODES, stepLabel } from '../../data.js'

export const FLOW_ICONS = [
  'flows',
  'sparkles',
  'mic',
  'image',
  'edit',
  'list',
  'wand',
  'brain',
  'book',
]

// Last run per flow (LRU, max 8) so switching views doesn't lose in-progress or finished runs.
const flowRunCache = new Map()

export function cachedRun(flowId) {
  return flowRunCache.get(flowId) || null
}

export function cacheRun(run) {
  flowRunCache.set(run.flowId, run)
  if (flowRunCache.size > 8) {
    flowRunCache.delete(flowRunCache.keys().next().value)
  }
}

export function inputStep(flow) {
  return flow.steps.find((s) => s.type === 'input') || null
}

export function outputStep(flow) {
  return flow.steps.find((s) => s.type === 'output') || null
}

// Step icons & titles
export function stepIcon(step) {
  if (step.type === 'input') {
    if (step.mode === 'image') return 'image'
    if (step.mode === 'audio') return 'mic'
    return 'text'
  }
  if (step.type === 'task') return 'sparkles'
  if (step.type === 'transcribe') return 'mic'
  if (step.type === 'output') return 'check'
  return 'sparkles'
}

export function stepTitle(step) {
  if (step.type === 'task') return step.name || 'AI task'
  if (step.type === 'input') return step.label || `${INPUT_MODES[step.mode]?.label || 'Text'} input`
  if (step.type === 'transcribe') return 'Speech to text'
  if (step.type === 'output') return step.label || 'Output'
  return stepLabel(step)
}
