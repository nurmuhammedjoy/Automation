// Run-history persistence via IndexedDB (single store, newest first).
const DB_NAME = 'modu-runs'
const DB_VERSION = 1
const STORE = 'runs'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('Could not open run history'))
  })
  return dbPromise
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveRun(run, keep = 40) {
  const db = await openDB()
  await requestToPromise(tx(db, 'readwrite').put(run))
  await pruneRuns(keep)
  return run
}

export async function getRun(id) {
  const db = await openDB()
  return requestToPromise(tx(db, 'readonly').get(id))
}

export async function listRuns() {
  const db = await openDB()
  const all = await requestToPromise(tx(db, 'readonly').getAll())
  return (all || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export async function listRunSummaries() {
  const runs = await listRuns()
  return runs.map((r) => ({
    id: r.id,
    title: r.title,
    flowName: r.flowName,
    icon: r.icon,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    output: r.outputPreview || '',
    stepCount: r.steps?.length || 0,
    model: r.model || '',
    durationMs: r.durationMs || 0,
  }))
}

export async function deleteRun(id) {
  const db = await openDB()
  await requestToPromise(tx(db, 'readwrite').delete(id))
}

export async function clearRuns() {
  const db = await openDB()
  await requestToPromise(tx(db, 'readwrite').clear())
}

export async function pruneRuns(keep = 40) {
  const runs = await listRuns()
  if (runs.length <= keep) return 0
  const db = await openDB()
  const store = tx(db, 'readwrite')
  let removed = 0
  for (const run of runs.slice(Math.max(0, keep))) {
    store.delete(run.id)
    removed++
  }
  return removed
}

export async function countRuns() {
  const db = await openDB()
  return requestToPromise(tx(db, 'readonly').count())
}
