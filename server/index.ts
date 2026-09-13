import compression from 'compression'
import express, { type NextFunction, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PARAMS, type Param } from '../shared/types'
import { NotFound, Store } from './store'

const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787)
const D = 86_400_000

const store = new Store()
const app = express()
app.use(compression())
app.use(express.json())

const num = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const range = (req: Request, defaultDays: number) => {
  const now = store.now()
  const to = num(req.query.to, now)
  const from = num(req.query.from, to - defaultDays * D)
  if (from >= to) throw new BadRequest('`from` must be before `to`')
  return { from, to }
}

const parseParams = (v: unknown): Param[] => {
  if (typeof v !== 'string' || !v) return [...PARAMS]
  const list = v.split(',').filter((p): p is Param => (PARAMS as readonly string[]).includes(p))
  if (!list.length) throw new BadRequest('No valid parameters requested')
  return list
}

class BadRequest extends Error {}

const api = express.Router()

api.get('/health', (_req, res) => {
  res.json({ ok: true, now: store.now() })
})

api.get('/grid', (_req, res) => {
  res.json(store.grid())
})

api.get('/nodes/:id', (req, res) => {
  const { from, to } = range(req, 7)
  res.json(store.series(req.params.id, from, to))
})

api.get('/nodes/:id/lab', (req, res) => {
  res.json(store.lab(req.params.id))
})

api.get('/nodes/:id/ts', (req, res) => {
  res.json(store.tsDiagram(req.params.id, Math.min(100, Math.max(1, num(req.query.days, 30)))))
})

api.get('/nodes/:id/export.csv', (req, res) => {
  const { from, to } = range(req, 7)
  const params = parseParams(req.query.params)
  const body = store.csv(req.params.id, from, to, params)
  const stamp = (t: number) => new Date(t).toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="kordura_${req.params.id}_${stamp(from)}_${stamp(to)}.csv"`)
  res.send(body)
})

api.get('/environment', (req, res) => {
  const { from, to } = range(req, 7)
  res.json(store.environment(from, to))
})

api.get('/compare', (req, res) => {
  const [param] = parseParams(req.query.param ?? 'salinity')
  const { from, to } = range(req, 7)
  res.json(store.compare(param, from, to))
})

api.get('/alerts', (_req, res) => {
  res.json(store.alerts())
})

api.post('/alerts/:id/ack', (req, res) => {
  const by = String(req.body?.by ?? 'operator').slice(0, 60)
  res.json(store.acknowledge(req.params.id, by))
})

api.post('/alerts/:id/verdict', (req, res) => {
  const b = req.body ?? {}
  if (b.outcome !== 'confirmed' && b.outcome !== 'refuted') throw new BadRequest('outcome must be "confirmed" or "refuted"')
  const count = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(num(v, 0))))
  res.json(
    store.recordVerdict(req.params.id, {
      outcome: b.outcome,
      ecoli: count(b.ecoli),
      enterococci: count(b.enterococci),
      note: String(b.note ?? '').slice(0, 500),
      by: String(b.by ?? 'operator').slice(0, 60),
    }),
  )
})

app.use('/api', api)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// In production, serve the built interface from the same origin.
const dist = fileURLToPath(new URL('../web-dist', import.meta.url))
if (process.env.NODE_ENV === 'production' && existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: dist }))
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof NotFound) return res.status(404).json({ error: err.message })
  if (err instanceof BadRequest) return res.status(400).json({ error: err.message })
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
})

app.listen(PORT, () => {
  console.log(`[kordura] API listening on http://localhost:${PORT}`)
})
