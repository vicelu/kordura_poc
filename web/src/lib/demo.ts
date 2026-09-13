/**
 * Static demo backend (VITE_DEMO=1): runs the simulation in the browser and answers the same paths as
 * `server/index.ts`, so the interface can be hosted without the API. Alert acknowledgements and verdicts
 * live only in this tab.
 */
import { PARAMS, type Param } from '@shared/types'
import { NotFound, Store } from '../../../server/store'

const D = 86_400_000

let store: Store | null = null
// Yield once so the loading state paints before the ~0.5 s dataset build blocks the main thread.
const ready = new Promise<Store>((resolve) => setTimeout(() => resolve((store ??= new Store())), 0))

export class DemoError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const num = (v: unknown, fallback: number) => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

const range = (s: Store, q: URLSearchParams, defaultDays: number) => {
  const to = num(q.get('to'), s.now())
  const from = num(q.get('from'), to - defaultDays * D)
  if (from >= to) throw new DemoError(400, '`from` must be before `to`')
  return { from, to }
}

const parseParams = (v: string | null): Param[] => {
  if (!v) return [...PARAMS]
  const list = v.split(',').filter((p): p is Param => (PARAMS as readonly string[]).includes(p))
  if (!list.length) throw new DemoError(400, 'No valid parameters requested')
  return list
}

function route(s: Store, method: string, path: string, body: Record<string, unknown>): unknown {
  const url = new URL(path, 'http://demo')
  const q = url.searchParams
  const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

  if (method === 'GET') {
    if (seg[0] === 'grid' && seg.length === 1) return s.grid()
    if (seg[0] === 'environment' && seg.length === 1) {
      const { from, to } = range(s, q, 7)
      return s.environment(from, to)
    }
    if (seg[0] === 'compare' && seg.length === 1) {
      const [param] = parseParams(q.get('param') ?? 'salinity')
      const { from, to } = range(s, q, 7)
      return s.compare(param, from, to)
    }
    if (seg[0] === 'alerts' && seg.length === 1) return s.alerts()
    if (seg[0] === 'nodes' && seg[1]) {
      const id = seg[1]
      if (seg.length === 2) {
        const { from, to } = range(s, q, 7)
        return s.series(id, from, to)
      }
      if (seg[2] === 'lab') return s.lab(id)
      if (seg[2] === 'ts') return s.tsDiagram(id, Math.min(100, Math.max(1, num(q.get('days'), 30))))
      if (seg[2] === 'export.csv') {
        const { from, to } = range(s, q, 7)
        return s.csv(id, from, to, parseParams(q.get('params')))
      }
    }
  }

  if (method === 'POST' && seg[0] === 'alerts' && seg[1]) {
    const by = String(body.by ?? 'operator').slice(0, 60)
    if (seg[2] === 'ack') return s.acknowledge(seg[1], by)
    if (seg[2] === 'verdict') {
      if (body.outcome !== 'confirmed' && body.outcome !== 'refuted') throw new DemoError(400, 'outcome must be "confirmed" or "refuted"')
      const count = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(num(v, 0))))
      return s.recordVerdict(seg[1], {
        outcome: body.outcome,
        ecoli: count(body.ecoli),
        enterococci: count(body.enterococci),
        note: String(body.note ?? '').slice(0, 500),
        by,
      })
    }
  }

  throw new DemoError(404, 'Not found')
}

export async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const s = await ready
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  try {
    // Round-trip through JSON so callers never share (and mutate) the store's objects.
    return JSON.parse(JSON.stringify(route(s, init?.method ?? 'GET', path, body))) as T
  } catch (e) {
    if (e instanceof NotFound) throw new DemoError(404, e.message)
    throw e
  }
}

/** Builds the CSV in the browser and saves it; `href` is the `/api/...export.csv` URL the server would serve. */
export async function demoDownload(href: string) {
  const s = await ready
  const path = href.replace(/^\/api/, '')
  const csv = route(s, 'GET', path, {}) as string
  const url = new URL(path, 'http://demo')
  const [, , id] = url.pathname.split('/')
  const stamp = (t: string | null) => new Date(Number(t)).toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `kordura_${id}_${stamp(url.searchParams.get('from'))}_${stamp(url.searchParams.get('to'))}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
