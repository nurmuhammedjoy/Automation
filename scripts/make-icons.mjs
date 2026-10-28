#!/usr/bin/env node
// Draws the app node graph at 4x, downsamples it, then encodes PNG with zlib.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'icons')
const SS = 4

const ACCENT = [208, 188, 255]
const ACCENT_LIGHT = [244, 238, 255]
const BG_TOP = [38, 34, 49]
const BG_BOTTOM = [15, 17, 21]

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function blend(buf, width, x, y, r, g, b, a) {
  if (a <= 0) return
  const i = (y * width + x) * 4
  // Shapes are clipped to the icon background so glows never leak outside
  // the rounded square.
  if (buf[i + 3] <= 0) return
  const srcA = Math.min(1, a)
  const dstA = buf[i + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  buf[i] = (r * srcA + buf[i] * dstA * (1 - srcA)) / outA
  buf[i + 1] = (g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA
  buf[i + 2] = (b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA
  buf[i + 3] = outA * 255
}

function drawBackground(buf, width, height, { maskable }) {
  const radius = maskable ? 0 : width * 0.23
  const glowX = width * 0.78
  const glowY = height * 0.12
  const glowR = width * 0.55

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = true
      if (radius > 0) {
        const dx = x < radius ? radius - x : x > width - radius ? x - (width - radius) : 0
        const dy = y < radius ? radius - y : y > height - radius ? y - (height - radius) : 0
        inside = dx * dx + dy * dy <= radius * radius
      }
      if (!inside) continue

      const t = (x / width) * 0.62 + (y / height) * 0.38
      let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
      let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
      let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t

      const gd = Math.hypot(x - glowX, y - glowY) / glowR
      if (gd < 1) {
        const amount = (1 - gd) ** 2.2 * 0.13
        r += (ACCENT[0] - r) * amount
        g += (ACCENT[1] - g) * amount
        b += (ACCENT[2] - b) * amount
      }

      const i = (y * width + x) * 4
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
      buf[i + 3] = 255
    }
  }
}

function lineDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
}

function drawLine(buf, width, x1, y1, x2, y2, thickness, color, alpha = 1) {
  const pad = Math.ceil(thickness / 2 + 2)
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - pad))
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x1, x2) + pad))
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - pad))
  const maxY = Math.min(width - 1, Math.ceil(Math.max(y1, y2) + pad))
  const half = thickness / 2

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = lineDistance(x + 0.5, y + 0.5, x1, y1, x2, y2)
      if (d <= half) {
        const soft = Math.min(1, half + 1 - d)
        blend(buf, width, x, y, color[0], color[1], color[2], alpha * soft)
      }
    }
  }
}

function drawCircle(buf, width, cx, cy, radius, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(cx - radius - 2))
  const maxX = Math.min(width - 1, Math.ceil(cx + radius + 2))
  const minY = Math.max(0, Math.floor(cy - radius - 2))
  const maxY = Math.min(width - 1, Math.ceil(cy + radius + 2))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d <= radius) {
        const soft = Math.min(1, radius + 1 - d)
        blend(buf, width, x, y, color[0], color[1], color[2], alpha * soft)
      }
    }
  }
}

function drawGlow(buf, width, cx, cy, radius, color, alpha) {
  const minX = Math.max(0, Math.floor(cx - radius))
  const maxX = Math.min(width - 1, Math.ceil(cx + radius))
  const minY = Math.max(0, Math.floor(cy - radius))
  const maxY = Math.min(width - 1, Math.ceil(cy + radius))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
      if (d >= 1) continue
      const a = (1 - d) ** 2.4 * alpha
      blend(buf, width, x, y, color[0], color[1], color[2], a)
    }
  }
}

function downsample(src, width, height, size) {
  const out = new Uint8Array(size * size * 4)
  const samples = SS * SS
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * width + (x * SS + sx)) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = clampByte(r / a)
        out[o + 1] = clampByte(g / a)
        out[o + 2] = clampByte(b / a)
        out[o + 3] = clampByte((a / samples) * 255)
      }
    }
  }
  return out
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePng(rgba, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function drawIcon(size, { maskable = false } = {}) {
  const width = size * SS
  const height = width
  const buf = new Float32Array(width * height * 4)

  drawBackground(buf, width, height, { maskable })

  const margin = width * (maskable ? 0.235 : 0.185)
  const span = width - margin * 2
  const p = (nx, ny) => [margin + nx * span, margin + ny * span]
  const nodes = [p(0.18, 0.24), p(0.82, 0.34), p(0.52, 0.84)]
  const lineWidth = width * (maskable ? 0.016 : 0.019)
  const nodeRadius = width * (maskable ? 0.085 : 0.092)

  for (const [x, y] of nodes) {
    drawGlow(buf, width, x, y, nodeRadius * 3.2, ACCENT, 0.18)
  }

  drawLine(buf, width, nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1], lineWidth, ACCENT, 0.72)
  drawLine(buf, width, nodes[0][0], nodes[0][1], nodes[2][0], nodes[2][1], lineWidth, ACCENT, 0.78)
  drawLine(buf, width, nodes[1][0], nodes[1][1], nodes[2][0], nodes[2][1], lineWidth, ACCENT, 0.6)

  for (let i = 0; i < nodes.length; i++) {
    const [x, y] = nodes[i]
    drawCircle(buf, width, x, y, nodeRadius, ACCENT, 1)
    drawCircle(buf, width, x - nodeRadius * 0.22, y - nodeRadius * 0.24, nodeRadius * 0.46, ACCENT_LIGHT, 0.55)
  }

  return encodePng(downsample(buf, width, height, size), size)
}

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true },
  { name: 'favicon-32.png', size: 32, maskable: false },
]

await fs.mkdir(outDir, { recursive: true })
for (const target of targets) {
  const png = drawIcon(target.size, { maskable: target.maskable })
  await fs.writeFile(path.join(outDir, target.name), png)
  console.log(`icons: ${target.name} (${target.size}×${target.size}, ${Math.round(png.length / 1024)} KB)`)
}
console.log(`icons written to ${path.relative(root, outDir)}`)
