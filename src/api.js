// Network layer: Groq chat/transcription + model listing.
import { FALLBACK_MODELS } from './data.js'
import { setModelCache, state } from './store.js'
import { isAbort, modelKind } from './util.js'

export const MAX_DIRECT_AUDIO = 24 * 1024 * 1024

function base() {
  return (state.settings.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')
}

function apiKey() {
  return (state.settings.apiKey || '').trim()
}

export function requireKey() {
  const key = apiKey()
  if (!key) {
    const err = new Error('Add your Groq API key in Settings first.')
    err.code = 'NO_KEY'
    throw err
  }
  return key
}

async function readError(res) {
  let body = null
  try {
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = { message: text.slice(0, 500) }
    }
  } catch {}
  const message =
    body?.error?.message ||
    body?.message ||
    (res.status === 401
      ? 'Invalid API key (401). Check it in Settings.'
      : res.status === 429
        ? 'Rate limit reached (429). Wait a moment and try again.'
        : `Request failed (${res.status})`)
  const err = new Error(message)
  err.status = res.status
  err.body = body
  err.retryAfter = res.headers.get('retry-after')
  return err
}

function endpoint(path) {
  return `${base()}${path}`
}

export function normalizeModel(raw) {
  const id = raw?.id || raw?.name || ''
  if (!id) return null
  const kind = modelKind(id)
  return {
    id,
    label: raw?.name || id.split('/').pop(),
    kind,
    context: raw?.context_window || raw?.context_length || 0,
    ownedBy: raw?.owned_by || '',
    active: raw?.active !== false,
  }
}

export async function listModels({ signal } = {}) {
  const key = requireKey()
  let res
  try {
    res = await fetch(endpoint('/models'), {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    })
  } catch (err) {
    if (isAbort(err)) throw err
    const e = new Error('Could not reach the AI provider. Check your connection and API base URL.')
    e.cause = err
    throw e
  }
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  const raw = Array.isArray(data?.data) ? data.data : []
  const seen = new Set()
  const merged = []
  for (const item of raw) {
    const m = normalizeModel(item)
    if (!m || seen.has(m.id)) continue
    seen.add(m.id)
    merged.push(m)
  }
  for (const fb of FALLBACK_MODELS) {
    if (!seen.has(fb.id)) merged.push({ ...fb, fallback: true, active: true })
  }
  const order = { vision: 0, text: 1, stt: 2, tts: 3 }
  merged.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || a.id.localeCompare(b.id))
  return { models: merged }
}

export async function refreshModels() {
  const result = await listModels()
  setModelCache(result.models, Date.now())
  return result
}

export function modelLabel(id) {
  return id || 'default'
}

// Chat (streaming)
export async function chatStream({
  model,
  messages,
  temperature = 0.35,
  maxTokens = 3000,
  signal,
  onDelta,
  onUsage,
}) {
  requireKey()
  if (!model) throw new Error('No model selected. Pick one in Settings → Models.')

  const payload = { model, messages, temperature, stream: true }
  if (maxTokens > 0) payload.max_completion_tokens = maxTokens

  let res
  try {
    res = await fetch(endpoint('/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (isAbort(err)) throw err
    const e = new Error('Could not reach the AI provider. Check your connection and API base URL.')
    e.cause = err
    throw e
  }

  if (!res.ok) throw await readError(res)

  const type = res.headers.get('content-type') || ''
  if (!type.includes('text/event-stream')) {
    const data = await res.json().catch(() => null)
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error('The provider returned an unexpected response.')
    onDelta?.(text)
    const usage = data?.usage || data?.x_groq?.usage || null
    if (usage) onUsage?.(usage)
    return { text, usage, model }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = null

  const handleLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return false
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data) return false
    if (data === '[DONE]') return true
    let json
    try {
      json = JSON.parse(data)
    } catch {
      return false
    }
    if (json?.error) throw new Error(json.error.message || 'The model returned an error.')
    const delta = json?.choices?.[0]?.delta
    let piece = ''
    if (typeof delta?.content === 'string') piece = delta.content
    else if (Array.isArray(delta?.content)) {
      piece = delta.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
    }
    if (piece) {
      text += piece
      onDelta?.(piece)
    }
    const u = json?.usage || json?.x_groq?.usage
    if (u) usage = u
    return false
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (handleLine(line)) {
          buffer = ''
          break
        }
      }
    }
    if (buffer) handleLine(buffer)
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }

  if (!text.trim()) {
    throw new Error('The model returned an empty response. Try again or switch models.')
  }
  if (usage) onUsage?.(usage)
  return { text, usage, model }
}

// Speech to text
export async function transcribeDirect({ blob, filename, model, language, prompt, signal, onProgress }) {
  requireKey()
  if (!blob) throw new Error('No audio to transcribe.')
  if (blob.size > MAX_DIRECT_AUDIO) {
    const err = new Error(
      `This audio is ${formatMb(blob.size)}. Groq accepts up to 24 MB per upload. Export a smaller MP3 (64–96 kbps) and try again.`,
    )
    err.code = 'TOO_LARGE'
    throw err
  }
  const form = new FormData()
  form.append('file', blob, filename || 'audio.mp3')
  form.append('model', model)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  if (language && language !== 'auto') form.append('language', language)
  if (prompt) form.append('prompt', prompt)

  onProgress?.({ percent: 20, message: 'Uploading audio with your key…' })
  let res
  try {
    res = await fetch(endpoint('/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
      signal,
    })
  } catch (err) {
    if (isAbort(err)) throw err
    throw new Error('Could not upload audio. Check your connection.')
  }
  if (!res.ok) throw await readError(res)
  onProgress?.({ percent: 100, message: 'Transcription ready' })
  const data = await res.json()
  const text = data?.text || ''
  if (!text.trim()) throw new Error('Transcription came back empty.')
  return { text: text.trim(), chunks: 1, usage: data?.usage || null }
}

export async function transcribeAudio(opts) {
  if (!opts?.blob) throw new Error('No audio available to transcribe.')
  return transcribeDirect(opts)
}

function formatMb(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`
}


