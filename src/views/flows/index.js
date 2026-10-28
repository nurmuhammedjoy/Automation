// Flows entry: routes to the flow list or to one flow build/run view.
import { renderFlowDetail } from './detail.js'
import { renderFlowList } from './list.js'

export function renderFlows(root, { parts = [] } = {}) {
  const flowId = parts[0]
  if (!flowId) return renderFlowList(root)
  return renderFlowDetail(root, flowId, parts[1] === 'run' ? 'run' : 'build')
}
