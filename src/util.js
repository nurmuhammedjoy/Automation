// Dependency-free helpers: escaping, formatting, image prep, markdown.
let counter = 0
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1e6
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}

export function truncate(text, len = 90) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > len ? `${s.slice(0, len - 1)}…` : s
}

export function markdownToPlainText(markdown) {
  if (!markdown) return ''
  let text = String(markdown).replace(/\r\n?/g, '\n')

  text = text.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => ` ${code} `)
  text = text.replace(/`([^`\n]+)`/g, '$1')

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '')
  text = text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')

  text = text.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
  text = text.replace(/\|/g, ' ')

  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  text = text.replace(/__([^_\n]+)__/g, '$1')
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
  text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2')
  text = text.replace(/~~([^~\n]+)~~/g, '$1')
  text = text.replace(/\*\*/g, '').replace(/~~/g, '')

  text = text.replace(/<[^>]+>/g, ' ')

  return text.replace(/\s+/g, ' ').trim()
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const value = n / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatDuration(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  const s = Math.round(n)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function formatDate(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toLocaleString()
  }
}

export function formatNumber(n) {
  return new Intl.NumberFormat().format(Number(n) || 0)
}

export function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length
}

export function debounce(fn, wait = 250) {
  let timer
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => clearTimeout(timer)
  wrapped.flush = (...args) => {
    clearTimeout(timer)
    fn(...args)
  }
  return wrapped
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.append(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }))
}

export function safeFilename(name, fallback = 'output') {
  return (
    String(name || fallback)
      .replace(/[^\w\-. ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || fallback
  )
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

// Keep vision requests fast and under Groq's image limits.
// Image preparation
export async function prepareImage(file, { maxDim = 1600, quality = 0.86 } = {}) {
  if (!file) throw new Error('No image selected')
  if (!file.type?.startsWith('image/')) throw new Error('That file is not an image')

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    bitmap = await loadImageElement(file)
  }

  const width = bitmap.width || bitmap.naturalWidth
  const height = bitmap.height || bitmap.naturalHeight
  const scale = Math.min(1, maxDim / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const approxBytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
  return {
    dataUrl,
    name: file.name || 'image.jpg',
    size: approxBytes,
    originalSize: file.size,
    width: w,
    height: h,
  }
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode image'))
    }
    img.src = url
  })
}

export function isVisionModel(id = '') {
  const s = String(id).toLowerCase()
  return (
    /(^|[/_-])(vision|vl)([/_-]|$)/.test(s) ||
    s.includes('qwen3.8') ||
    s.includes('qwen3-vl') ||
    s.includes('qwen2.5-vl') ||
    s.includes('qwen2-vl') ||
    s.includes('llama-4') ||
    s.includes('llama4') ||
    s.includes('maverick') ||
    s.includes('scout') ||
    s.includes('muse-spark') ||
    s.includes('pixtral') ||
    s.includes('llava') ||
    s.includes('multimodal') ||
    s.includes('internvl') ||
    s.includes('idefics') ||
    s.includes('paligemma') ||
    s.includes('medgemma') ||
    s.includes('moondream') ||
    s.includes('mistral-small-3') ||
    s.includes('gemma-3') ||
    s.includes('gemma3')
  )
}

// Classification, guard, and embedding models are not chat models.
export function isUtilityModel(id = '') {
  const s = String(id).toLowerCase()
  return (
    s.includes('guard') ||
    s.includes('safety') ||
    s.includes('safeguard') ||
    s.includes('moderation') ||
    s.includes('embedding') ||
    s.includes('rerank')
  )
}

export function isSttModel(id = '') {
  const s = String(id).toLowerCase()
  return s.includes('whisper') || s.includes('transcrib') || s.includes('speech')
}

export function isTtsModel(id = '') {
  const s = String(id).toLowerCase()
  return (
    s.includes('orpheus') ||
    s.includes('canopy') ||
    /\b(tts|text-to-speech)\b/.test(s) ||
    s.includes('tts') ||
    s.includes('voice') ||
    s.includes('chatterbox') ||
    s.includes('kokoro') ||
    s.includes('elevenlabs')
  )
}

export function modelKind(id = '') {
  if (isTtsModel(id)) return 'tts'
  if (isSttModel(id)) return 'stt'
  if (isUtilityModel(id)) return 'utility'
  if (isVisionModel(id)) return 'vision'
  return 'text'
}

export function shortModelName(id = '') {
  const s = String(id)
  if (!s) return 'default'
  return s.split('/').pop()
}

export function hostOf(url = '') {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function parseError(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err.name === 'AbortError') return 'Cancelled'
  return err.message || String(err)
}

export function normalizeUrl(value) {
  try {
    const u = new URL(String(value).trim())
    if (!['http:', 'https:'].includes(u.protocol)) return null
    return u.toString()
  } catch {
    return null
  }
}

export function isAbort(err) {
  return err?.name === 'AbortError' || /aborted|abort/i.test(err?.message || '')
}

/** Tiny, safe markdown renderer (escapes first; no raw HTML is ever emitted). */
// Markdown -> HTML
export function mdToHtml(markdown) {
  if (!markdown) return ''
  const source = String(markdown).replace(/\r\n?/g, '\n')
  const codeBlocks = []
  const inlineCodes = []

  let text = source.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = codeBlocks.length
    const language = String(lang).trim().replace(/[^\w+-]/g, '')
    codeBlocks.push(
      `<pre${language ? ` data-lang="${language}"` : ''}><code>${esc(code.replace(/\n$/, ''))}</code></pre>`,
    )
    return `\n\u0000CB${i}\u0000\n`
  })

  text = esc(text)

  // Preserve placeholder lines after escaping (null chars survive).
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = inlineCodes.length
    inlineCodes.push(`<code>${code}</code>`)
    return `\u0000IC${i}\u0000`
  })

  const lines = text.split('\n')
  const out = []
  let i = 0

  const isBlockStart = (line) =>
    /^\s*(#{1,6})\s+/.test(line) ||
    /^\s*([-*+])\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    /^\s*\|.*\|\s*$/.test(line) ||
    /^\u0000CB\d+\u0000$/.test(line.trim())

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    const cb = trimmed.match(/^\u0000CB(\d+)\u0000$/)
    if (cb) {
      out.push(codeBlocks[Number(cb[1])] ?? '')
      i++
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    if (/^---+$/.test(trimmed)) {
      out.push('<hr>')
      i++
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`)
      continue
    }

    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = splitRow(trimmed)
      const aligns = splitRow(lines[i + 1].trim()).map((c) => {
        const t = c.trim()
        if (t.startsWith(':') && t.endsWith(':')) return 'center'
        if (t.endsWith(':')) return 'right'
        return 'left'
      })
      i += 2
      const body = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        body.push(splitRow(lines[i].trim()))
        i++
      }
      const th = header
        .map((c, idx) => `<th style="text-align:${aligns[idx] || 'left'}">${inline(c.trim())}</th>`)
        .join('')
      const trs = body
        .map(
          (row) =>
            `<tr>${row
              .map((c, idx) => `<td style="text-align:${aligns[idx] || 'left'}">${inline(c.trim())}</td>`)
              .join('')}</tr>`,
        )
        .join('')
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`)
      continue
    }

    if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (i < lines.length) {
        const l = lines[i]
        const m = l.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/)
        if (!m) break
        const isOrdered = Boolean(m[2])
        if (isOrdered !== ordered) break
        let content = m[3]
        i++
        // Lazy continuation lines
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) {
          content += ` ${lines[i].trim()}`
          i++
        }
        items.push(`<li>${inline(content)}</li>`)
        if (i < lines.length && !lines[i].trim()) {
          // A blank line ends the list unless another item follows.
          let j = i
          while (j < lines.length && !lines[j].trim()) j++
          if (j < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j])) {
            i = j
            continue
          }
          break
        }
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }

    const buf = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i].trim())
      i++
    }
    out.push(`<p>${inline(buf.join('\n'))}</p>`)
  }

  return out.join('\n').replace(/\n/g, '\n')

  function inline(value) {
    let s = value
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    s = s.replace(/\n/g, '<br>')
    s = s.replace(/\u0000IC(\d+)\u0000/g, (_, idx) => inlineCodes[Number(idx)] ?? '')
    return s
  }

  function splitRow(row) {
    return row.replace(/^\|/, '').replace(/\|$/, '').split('|')
  }
}

export function extractJson(text) {
  if (!text) return null
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const match = cleaned.match(/[{[][\s\S]*[}\]]/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export function groupBy(items, keyFn) {
  const map = new Map()
  for (const item of items) {
    const key = keyFn(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}
