#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const notes = []

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', 'public/icons'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

const files = await walk(root)
const jsFiles = files.filter((file) => /\.(mjs|js)$/.test(file))

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) {
    errors.push(`${path.relative(root, file)}: ${(result.stderr || '').trim().split('\n')[0]}`)
  }
}
notes.push(`syntax: ${jsFiles.length} JavaScript files parsed`)

const indexHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8').catch(() => '')
if (!indexHtml.includes('/src/main.js')) errors.push('index.html does not reference /src/main.js')
const mainFile = path.join(root, 'src', 'main.js')
if (!(await exists(mainFile))) errors.push('src/main.js is missing')

const manifestPath = path.join(root, 'public', 'manifest.webmanifest')
const manifestText = await fs.readFile(manifestPath, 'utf8').catch(() => '')
if (!manifestText) {
  errors.push('public/manifest.webmanifest is missing')
} else {
  try {
    const manifest = JSON.parse(manifestText)
    if (!manifest.name || !manifest.start_url) errors.push('manifest is missing name or start_url')
    for (const iconEntry of manifest.icons || []) {
      const iconPath = path.join(root, 'public', String(iconEntry.src || '').replace(/^\//, ''))
      if (!(await exists(iconPath))) errors.push(`manifest icon is missing: ${iconEntry.src}`)
    }
    if (!(manifest.icons || []).some((i) => String(i.sizes || '').includes('512'))) {
      errors.push('manifest has no 512px icon')
    }
  } catch (err) {
    errors.push(`manifest is not valid JSON: ${err.message}`)
  }
}

for (const icon of [
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-512-maskable.png',
  'public/icons/apple-touch-icon.png',
]) {
  if (!(await exists(path.join(root, icon)))) errors.push(`${icon} is missing (run npm run icons)`)
}

for (const file of ['public/sw.js', 'public/manifest.webmanifest']) {
  if (!(await exists(path.join(root, file)))) errors.push(`${file} is missing`)
}

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
for (const script of ['dev', 'build', 'preview', 'icons', 'check', 'smoke']) {
  if (!pkg.scripts?.[script]) errors.push(`package.json has no "${script}" script`)
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem${errors.length === 1 ? '' : 's'} found:`)
  for (const err of errors) console.error(`  · ${err}`)
  process.exit(1)
}

console.log('✓ Checks passed')
for (const note of notes) console.log(`  · ${note}`)
console.log('  · manifest, service worker, icons, and entry point are in place')
