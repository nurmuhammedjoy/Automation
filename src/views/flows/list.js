// Flow list view: flow cards plus the per-flow action menu.
import { createFlow, flowSummary } from '../../data.js'
import { addFlow, deleteFlow, duplicateFlow, getFlow, resetFlow, state } from '../../store.js'
import { icon } from '../../icons.js'
import { $, $$, apiKeyBanner, confirmDialog, emptyState, showModal, toast } from '../../components.js'
import { esc } from '../../util.js'

export function renderFlowList(root) {
  let disposed = false

  function mount() {
    if (disposed) return
    const cards = state.flows
      .map((flow) => {
        const count = flow.steps.length
        return `<article class="flow-row" data-flow-card="${esc(flow.id)}">
          <button type="button" class="flow-row-main" data-open-flow="${esc(flow.id)}">
            <span class="m-avatar" data-tone="${esc(flow.icon || 'flows')}">${icon(flow.icon || 'flows', 'size-5')}</span>
            <span class="flow-row-copy">
              <span class="flow-row-title">
                <span class="flow-row-name">${esc(flow.name)}</span>
              </span>
              <span class="flow-row-sub">${esc(flow.description || flowSummary(flow))}</span>
              <span class="flow-row-meta">${count} step${count === 1 ? '' : 's'}${flow.builtIn ? ' · Template' : ''}</span>
            </span>
          </button>
          <div class="flow-row-actions">
            <a class="btn-icon btn-icon-tonal" href="#flows/${esc(flow.id)}/run" aria-label="Run ${esc(flow.name)}" title="Run flow">${icon('play', 'size-5')}</a>
            <button type="button" class="btn-icon" data-flow-menu="${esc(flow.id)}" aria-label="More actions for ${esc(flow.name)}">${icon('moreVert', 'size-5')}</button>
          </div>
        </article>`
      })
      .join('')

    root.innerHTML = `<div>
      <header class="page-head">
        <div class="page-head-copy">
          <h1 class="page-title">Flows</h1>
          <p class="page-sub">Build a chain of steps, then run it with your own input.</p>
        </div>
      </header>

      ${apiKeyBanner()}

      <section class="m-group">
        <div class="section-head">
          <h2>Your flows</h2>
          <span class="section-count">${state.flows.length}</span>
        </div>
        <div class="card flow-list">${
          cards ||
          emptyState({
            iconName: 'flows',
            title: 'No flows yet',
            text: 'Create a flow to get started. You can add steps and rearrange them at any time.',
          })
        }</div>
      </section>

      <button type="button" class="fab" id="new-flow">${icon('plus', 'size-6')} New flow</button>
    </div>`

    $$('[data-open-flow]', root).forEach((btn) => {
      btn.addEventListener('click', () => {
        location.hash = `#flows/${btn.dataset.openFlow}`
      })
    })
    const create = () => {
      const flow = addFlow(createFlow())
      location.hash = `#flows/${flow.id}`
    }
    $('#new-flow', root)?.addEventListener('click', create)
    $$('[data-flow-menu]', root).forEach((btn) => {
      btn.addEventListener('click', () => openFlowMenu(btn.dataset.flowMenu, mount))
    })
  }

  mount()
  return () => {
    disposed = true
  }
}

// Per-flow action menu
function openFlowMenu(flowId, onChange) {
  const flow = getFlow(flowId)
  if (!flow) return
  showModal({
    title: flow.name,
    subtitle: 'Flow actions',
    body: `<div class="grid gap-2">
      <a href="#flows/${esc(flow.id)}/run" class="m-menu-item" data-close>${icon('play', 'size-4')} Run flow</a>
      <a href="#flows/${esc(flow.id)}" class="m-menu-item" data-close>${icon('flows', 'size-4')} Open graph</a>
      <button type="button" class="m-menu-item" data-duplicate>${icon('copy', 'size-4')} Duplicate</button>
      ${
        flow.builtIn
          ? `<button type="button" class="m-menu-item" data-reset>${icon('reset', 'size-4')} Reset template</button>`
          : `<button type="button" class="m-menu-item m-danger" data-delete>${icon('trash', 'size-4')} Delete flow</button>`
      }
    </div>`,
    onMount: ({ root, close }) => {
      $('[data-duplicate]', root).onclick = () => {
        const copy = duplicateFlow(flow.id)
        close()
        if (copy) {
          onChange?.()
          location.hash = `#flows/${copy.id}`
        }
      }
      $('[data-reset]', root)?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Reset this template?',
          message: 'The steps and prompts will return to the original template.',
          confirmText: 'Reset',
        })
        if (!ok) return
        resetFlow(flow.id)
        close()
        onChange?.()
        toast('Template reset', 'success')
      })
      $('[data-delete]', root)?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Delete this flow?',
          message: 'Saved runs keep their output. This flow will be removed from this device.',
          confirmText: 'Delete flow',
          danger: true,
        })
        if (!ok) return
        deleteFlow(flow.id)
        close()
        onChange?.()
        toast('Flow deleted', 'success')
      })
    },
  })
}
