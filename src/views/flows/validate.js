// Flow/step validation: problem lists for the build gate and editor save.
import { inputStep, outputStep } from './shared.js'

// Whole-flow checks
export function flowIssues(flow) {
  const out = []
  const input = inputStep(flow)
  if (!input) out.push('Add an Input node.')
  if (!outputStep(flow)) out.push('Add an Output node.')
  if (
    !flow.steps.some((s) => s.type === 'task') &&
    !flow.steps.some((s) => s.type === 'transcribe')
  ) {
    out.push('Add at least one AI task.')
  }
  for (const step of flow.steps) {
    if (step.type === 'task' && !step.instruction?.trim()) {
      out.push(`“${step.name || 'AI task'}” has no instruction.`)
    }
  }

  const mode = input?.mode || 'text'
  const firstTask = flow.steps.findIndex((s) => s.type === 'task')
  const transcribeIndex = flow.steps.findIndex((s) => s.type === 'transcribe')
  const hasTranscribe = transcribeIndex >= 0

  if (mode === 'audio' && !hasTranscribe) out.push('Add a Speech to text step for the audio file.')
  if (mode !== 'audio' && hasTranscribe) out.push('Speech to text needs an Audio file input.')
  if (mode === 'image' && !flow.steps.some((s) => s.type === 'task' && s.useImage)) {
    out.push('Turn on “Attach the image input” for an AI task.')
  }
  if (firstTask >= 0 && transcribeIndex > firstTask) out.push('Move Speech to text before the AI tasks.')
  return out
}

// Step save gate
export function stepSaveErrors(next) {
  const out = []
  if (next.type === 'task' && !next.instruction?.trim()) {
    out.push('Add an instruction for this AI step.')
  }
  return out
}
