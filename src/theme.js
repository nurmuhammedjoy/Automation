// Accent colors: presets plus a custom seed expanded into M3-like role tokens.

export const ACCENT_PRESETS = Object.freeze([
  { id: 'default', label: 'Material', color: '#b39ddb' },
  { id: 'groq', label: 'Groq', color: '#f55036' },
  { id: 'ocean', label: 'Ocean', color: '#4f8ef7' },
  { id: 'forest', label: 'Forest', color: '#4caf72' },
  { id: 'rose', label: 'Rose', color: '#e46b8a' },
  { id: 'amber', label: 'Amber', color: '#e0a526' },
])

const ACCENT_VARS = [
  '--primary',
  '--on-primary',
  '--primary-container',
  '--on-primary-container',
  '--secondary',
  '--on-secondary',
  '--secondary-container',
  '--on-secondary-container',
  '--tertiary',
  '--on-tertiary',
  '--tertiary-container',
  '--on-tertiary-container',
  '--surface',
  '--surface-dim',
  '--surface-bright',
  '--surface-container-lowest',
  '--surface-container-low',
  '--surface-container',
  '--surface-container-high',
  '--surface-container-highest',
  '--on-surface',
  '--on-surface-variant',
  '--on-surface-muted',
  '--outline',
  '--outline-variant',
  '--inverse-primary',
]

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isAccentColor(value) {
  return typeof value === 'string' && HEX_RE.test(value)
}

function normalizeHex(value) {
  const raw = value.slice(1)
  const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  return `#${hex.toLowerCase()}`
}

export function accentSeed(value) {
  if (isAccentColor(value)) return normalizeHex(value)
  return ACCENT_PRESETS.find((preset) => preset.id === value)?.color || ACCENT_PRESETS[0].color
}

export function accentLabel(value) {
  if (isAccentColor(value)) return 'Custom'
  return ACCENT_PRESETS.find((preset) => preset.id === value)?.label || ACCENT_PRESETS[0].label
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function hexToHsl(hex) {
  const clean = hex.slice(1)
  const number = Number.parseInt(clean, 16)
  const r = ((number >> 16) & 255) / 255
  const g = ((number >> 8) & 255) / 255
  const b = (number & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness * 100 }

  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return { h: hue * 60, s: saturation * 100, l: lightness * 100 }
}

function hsl(hue, saturation, lightness) {
  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`
}

function paletteFromSeed(seed) {
  const { h, s } = hexToHsl(seed)
  const accentS = clamp(s, 0, 78)
  const tertiaryHue = (h + 55) % 360
  const tertiaryS = s < 10 ? 0 : clamp(s, 28, 48)

  return {
    '--primary': hsl(h, clamp(accentS, 0, 78), 80),
    '--on-primary': hsl(h, Math.min(s, 45), 22),
    '--primary-container': hsl(h, clamp(accentS, 0, 60), 38),
    '--on-primary-container': hsl(h, clamp(accentS, 0, 75), 90),
    '--secondary': hsl(h, Math.min(s, 18), 78),
    '--on-secondary': hsl(h, Math.min(s, 18), 22),
    '--secondary-container': hsl(h, Math.min(s, 22), 38),
    '--on-secondary-container': hsl(h, Math.min(s, 22), 90),
    '--tertiary': hsl(tertiaryHue, tertiaryS, 80),
    '--on-tertiary': hsl(tertiaryHue, tertiaryS, 22),
    '--tertiary-container': hsl(tertiaryHue, tertiaryS, 38),
    '--on-tertiary-container': hsl(tertiaryHue, tertiaryS, 90),
    // Keep the background shift subtle: surfaces borrow only a little of the accent hue.
    '--surface': hsl(h, Math.min(s, 12), 8),
    '--surface-dim': hsl(h, Math.min(s, 12), 8),
    '--surface-bright': hsl(h, Math.min(s, 8), 23),
    '--surface-container-lowest': hsl(h, Math.min(s, 12), 6),
    '--surface-container-low': hsl(h, Math.min(s, 9), 12),
    '--surface-container': hsl(h, Math.min(s, 9), 13),
    '--surface-container-high': hsl(h, Math.min(s, 8), 18),
    '--surface-container-highest': hsl(h, Math.min(s, 8), 22),
    '--on-surface': hsl(h, Math.min(s, 10), 90),
    '--on-surface-variant': hsl(h, Math.min(s, 10), 74),
    '--on-surface-muted': hsl(h, Math.min(s, 8), 56),
    '--outline': hsl(h, Math.min(s, 8), 56),
    '--outline-variant': hsl(h, Math.min(s, 9), 25),
    '--inverse-primary': hsl(h, clamp(accentS, 0, 70), 38),
  }
}

function clearAccent(root) {
  for (const name of ACCENT_VARS) root.style.removeProperty(name)
}

export function applyAccent(root, value) {
  if (value === 'default') {
    clearAccent(root)
    return ''
  }
  if (!isAccentColor(value) && !ACCENT_PRESETS.some((preset) => preset.id === value)) {
    clearAccent(root)
    return ''
  }
  const palette = paletteFromSeed(accentSeed(value))
  for (const [name, color] of Object.entries(palette)) {
    root.style.setProperty(name, color)
  }
  return palette['--surface']
}
