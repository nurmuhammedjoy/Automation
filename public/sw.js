/* Service worker: offline app shell, network-first navigation. */
const VERSION = 'app-v5'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const ROOT = new URL('./', self.location.href).href
const SHELL = [
  ROOT,
  new URL('manifest.webmanifest', ROOT).href,
  new URL('icons/icon-192.png', ROOT).href,
  new URL('icons/icon-512.png', ROOT).href,
  new URL('icons/icon-512-maskable.png', ROOT).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(ROOT, response.clone()).catch(() => {})
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(ROOT))
    if (cached) return cached
    return new Response(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <body style="font:15px system-ui;padding:32px;line-height:1.6;background:#0f1115;color:#e7e1e6">
      <h1>You're offline</h1><p>The app shell has not been cached yet. Reconnect and reload once.</p></body>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE)
    cache.put(request, response.clone()).catch(() => {})
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname === new URL('sw.js', ROOT).pathname) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // Hashed Vite assets are safe to cache indefinitely. The cache is versioned.
  if (
    url.pathname.startsWith(new URL('assets/', ROOT).pathname) ||
    url.pathname.startsWith(new URL('icons/', ROOT).pathname)
  ) {
    event.respondWith(cacheFirst(request))
  }
})
