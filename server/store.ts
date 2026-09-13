import {
  PARAMS,
  QC,
  type Alert,
  type AlertsResponse,
  type CompareResponse,
  type EnvNow,
  type EnvSeriesResponse,
  type GridResponse,
  type LabSample,
  type ModelEvaluation,
  type NodeSummary,
  type Param,
  type Regime,
  type Resolution,
  type SeriesResponse,
  type TsResponse,
  type Values,
} from '../shared/types'
import { analyse, levelOf, type Analysis } from './sim/detect'
import { STEP, buildEnvironment, type Environment } from './sim/environment'
import { generateNode, type NodeSeries, type NodeTruth } from './sim/generate'
import { buildLab } from './sim/lab'
import { LANDMARKS, NODES, SITE, type NodeProfile } from './sim/site'

const H = 3_600_000
const D = 86_400_000
const HISTORY_DAYS = 110
const WQ_KINDS = new Set(['runoff', 'organic'])

interface NodeData {
  profile: NodeProfile
  deployedAt: number
  series: NodeSeries
  truth: NodeTruth
  analysis: Analysis
  lab: LabSample[]
  cleanings: number[]
}

interface Dataset {
  anchor: number
  env: Environment
  nodes: Map<string, NodeData>
}

type Override = { ack?: Alert['ack']; verdict?: Alert['verdict'] }

export class Store {
  private ds!: Dataset
  private overrides = new Map<string, Override>()
  readonly seed: number

  constructor(seed = 20270515) {
    this.seed = seed
    this.rebuild()
  }

  private rebuild() {
    const started = Date.now()
    const anchor = Math.floor(started / H) * H
    const env = buildEnvironment(anchor, anchor - HISTORY_DAYS * D, anchor + 36 * H, this.seed)
    const nodes = new Map<string, NodeData>()
    for (const profile of NODES) {
      const { series, truth } = generateNode(profile, env, this.seed)
      const cleanings = truth.maintenance.filter((m) => m.kind !== 'calibration').map((m) => m.t)
      const deployedAt = anchor + profile.deployedAt
      const analysis = analyse(profile.id, series, env, cleanings)
      const lab = buildLab(profile.id, series, truth, env, analysis.alerts, deployedAt, this.seed)
      nodes.set(profile.id, { profile, deployedAt, series, truth, analysis, lab, cleanings })
    }
    this.ds = { anchor, env, nodes }
    console.log(`[kordura] dataset built in ${Date.now() - started} ms — ${[...nodes.values()].map((n) => `${n.profile.id}: ${n.series.t.length} samples`).join(', ')}`)
  }

  /** The simulated gateway only ever "has" samples up to the wall clock; regenerate daily. */
  private data(): Dataset {
    if (Date.now() > this.ds.anchor + 24 * H) this.rebuild()
    return this.ds
  }

  now() {
    return Date.now()
  }

  private node(id: string): NodeData {
    const n = this.data().nodes.get(id)
    if (!n) throw new NotFound(`Unknown node ${id}`)
    return n
  }

  nodeIds() {
    return NODES.map((n) => n.id)
  }

  // ---------- helpers ----------

  private upper(arr: Float64Array, t: number) {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private lower(arr: Float64Array, t: number) {
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private values(s: NodeSeries, j: number): Values {
    return Object.fromEntries(PARAMS.map((p) => [p, round(s.values[p][j], 4)])) as Values
  }

  private envIdx(t: number) {
    const { grid } = this.data().env
    return Math.max(0, Math.min(grid.n - 1, Math.round((t - grid.start) / STEP)))
  }

  private rainBetween(from: number, to: number) {
    const env = this.data().env
    let mm = 0
    for (let i = this.envIdx(from); i <= this.envIdx(to); i++) mm += env.rainMm[i]
    return mm
  }

  // ---------- alerts ----------

  private resolveAlert(nd: NodeData, a: Alert, now: number): Alert | null {
    if (a.openedAt > now) return null
    const out: Alert = { ...a, closedAt: a.closedAt !== null && a.closedAt <= now ? a.closedAt : null }
    const ov = this.overrides.get(a.id)
    if (WQ_KINDS.has(a.kind)) {
      const sample = nd.lab.find((l) => l.alertId === a.id && l.source === 'reference')
      if (sample && sample.t <= now) {
        out.state = 'sampling'
        out.ack = { at: a.openedAt + 25 * 60_000, by: 'on-call' }
        if (sample.resultAt <= now) {
          const confirmed = sample.assessment === 'sufficient' || sample.assessment === 'poor'
          out.state = confirmed ? 'confirmed' : 'refuted'
          out.verdict = { at: sample.resultAt, by: 'lab', outcome: confirmed ? 'confirmed' : 'refuted', ecoli: sample.ecoli, enterococci: sample.enterococci, note: '' }
          if (confirmed) {
            const routine = nd.lab.find(
              (l) =>
                (l.trigger === 'routine' || l.trigger === 'official') &&
                l.t >= a.openedAt - 12 * H && l.t <= a.openedAt + 5 * D &&
                (l.assessment === 'sufficient' || l.assessment === 'poor'),
            )
            out.leadTimeH = routine ? Math.round((routine.resultAt - a.openedAt) / H) : null
          }
        }
      } else if (out.closedAt) out.state = 'closed'
    } else {
      out.state = out.closedAt ? 'closed' : 'open'
    }
    if (ov?.ack && (out.state === 'open' || out.state === 'closed')) {
      out.ack = ov.ack
      if (out.state === 'open') out.state = 'acknowledged'
    }
    if (ov?.verdict) {
      out.verdict = ov.verdict
      out.state = ov.verdict.outcome
    }
    return out
  }

  private nodeAlerts(nd: NodeData, now: number) {
    return nd.analysis.alerts.map((a) => this.resolveAlert(nd, a, now)).filter((a): a is Alert => a !== null)
  }

  alerts(): AlertsResponse {
    const now = this.now()
    const all: Alert[] = []
    const ev: ModelEvaluation = { evaluated: 0, confirmed: 0, refuted: 0, pending: 0, missed: 0, precision: null, recall: null, medianLeadTimeH: null, unseenByRoutine: 0, suppressed: { freshwater: 0, upwelling: 0 } }
    const leads: number[] = []
    for (const nd of this.data().nodes.values()) {
      const list = this.nodeAlerts(nd, now)
      all.push(...list)
      ev.suppressed.freshwater += count(nd.analysis, now, nd.series, 'freshwater')
      ev.suppressed.upwelling += count(nd.analysis, now, nd.series, 'upwelling')
      const wq = list.filter((a) => WQ_KINDS.has(a.kind))
      for (const a of wq) {
        if (a.state === 'confirmed') {
          ev.confirmed++
          if (a.leadTimeH !== null) leads.push(a.leadTimeH)
          else ev.unseenByRoutine++
        } else if (a.state === 'refuted') ev.refuted++
        else ev.pending++
      }
      for (const l of nd.lab) {
        if (l.resultAt > now || l.trigger === 'sensor_alert') continue
        if (l.t < nd.deployedAt) continue
        if (l.assessment !== 'sufficient' && l.assessment !== 'poor') continue
        const covered = wq.some((a) => l.t >= a.openedAt - 24 * H && l.t <= (a.closedAt ?? now) + 24 * H)
        if (!covered) ev.missed++
      }
    }
    ev.evaluated = ev.confirmed + ev.refuted
    ev.precision = ev.evaluated ? ev.confirmed / ev.evaluated : null
    ev.recall = ev.confirmed + ev.missed ? ev.confirmed / (ev.confirmed + ev.missed) : null
    ev.medianLeadTimeH = leads.length ? median(leads) : null
    all.sort((a, b) => Number(b.closedAt === null) - Number(a.closedAt === null) || b.openedAt - a.openedAt)
    return { alerts: all, evaluation: ev }
  }

  acknowledge(id: string, by: string) {
    this.findAlert(id)
    const ov = this.overrides.get(id) ?? {}
    ov.ack = { at: this.now(), by }
    this.overrides.set(id, ov)
    return this.findAlert(id)
  }

  recordVerdict(id: string, v: { outcome: 'confirmed' | 'refuted'; ecoli: number | null; enterococci: number | null; note: string; by: string }) {
    this.findAlert(id)
    const ov = this.overrides.get(id) ?? {}
    ov.verdict = { at: this.now(), ...v }
    ov.ack ??= { at: this.now(), by: v.by }
    this.overrides.set(id, ov)
    return this.findAlert(id)
  }

  private findAlert(id: string): Alert {
    const now = this.now()
    for (const nd of this.data().nodes.values()) {
      const a = nd.analysis.alerts.find((x) => x.id === id)
      if (a) {
        const r = this.resolveAlert(nd, a, now)
        if (r) return r
      }
    }
    throw new NotFound(`Unknown alert ${id}`)
  }

  // ---------- node summaries ----------

  summary(id: string): NodeSummary {
    const nd = this.node(id)
    const now = this.now()
    const s = nd.series
    const end = this.upper(s.t, now)
    const j = end - 1
    const p = nd.profile
    const lastSeen = j >= 0 ? s.t[j] : null

    const from24 = now - 24 * H
    const i24 = this.lower(s.t, from24)
    const slotsFrom = Math.max(from24, nd.deployedAt)
    const expected = Math.max(0, Math.floor((now - slotsFrom) / (15 * 60_000)))
    let received = 0
    let valid = 0
    let flagged = 0
    for (let k = i24; k < end; k++) {
      if (s.qc[k] & QC.ADAPTIVE) continue
      received++
      if (!(s.qc[k] & (QC.SPIKE | QC.RANGE | QC.SETTLING))) valid++
      if (s.qc[k] & (QC.SPIKE | QC.RANGE | QC.SETTLING | QC.DRIFT)) flagged++
    }

    const j24 = Math.max(0, this.upper(s.t, (lastSeen ?? now) - 24 * H) - 1)
    const delta24h = Object.fromEntries(PARAMS.map((q) => [q, j >= 0 ? round(s.values[q][j] - s.values[q][j24], 4) : null])) as Values

    const lastClean = Math.max(...nd.cleanings.filter((c) => c <= now))
    const alerts = this.nodeAlerts(nd, now)
    const openAlerts = alerts.filter((a) => a.closedAt === null && !['confirmed', 'refuted'].includes(a.state)).length
    const riskScore = j >= 0 ? nd.analysis.risk[j] : 0
    const drift = alerts.some((a) => a.kind === 'drift' && a.closedAt === null)
    const pdr = expected ? Math.min(1, received / expected) : 1
    const offline = lastSeen === null || now - lastSeen > 2 * H
    const intervalMin = j > 0 && s.qc[j] & QC.ADAPTIVE ? 5 : 15

    // Sparkline: hourly means over the last 24 h.
    const spark = { t: [] as number[] } as NodeSummary['spark']
    for (const q of PARAMS) spark[q] = []
    for (let h = 24; h > 0; h--) {
      const b0 = now - h * H
      const a0 = this.lower(s.t, b0)
      const a1 = this.lower(s.t, b0 + H)
      spark.t.push(b0 + H / 2)
      for (const q of PARAMS) {
        let sum = 0
        let c = 0
        for (let k = a0; k < a1; k++) {
          if (s.qc[k] & (QC.SPIKE | QC.RANGE)) continue
          sum += s.values[q][k]
          c++
        }
        spark[q].push(c ? round(sum / c, 3) : null)
      }
    }

    return {
      id: p.id,
      name: p.name,
      place: p.place,
      lat: p.lat,
      lon: p.lon,
      depthM: p.depthM,
      deployedAt: nd.deployedAt,
      nearField: p.nearField,
      status: offline ? 'offline' : drift || pdr < 0.9 || (j >= 0 && s.battery[j] < 30) ? 'degraded' : 'online',
      lastSeen,
      latest: j >= 0 ? { t: s.t[j], values: this.values(s, j), qc: s.qc[j] } : null,
      delta24h,
      health: {
        batteryPct: j >= 0 ? round(s.battery[j], 1) : 0,
        batteryV: j >= 0 ? round(s.batteryV[j], 2) : 0,
        solarW: j >= 0 ? round(s.solarW[j], 2) : 0,
        rssi: j >= 0 ? Math.round(s.rssi[j]) : 0,
        snr: j >= 0 ? round(s.snr[j], 1) : 0,
        pdr24h: round(pdr, 3),
        intervalMin,
        enclosureRh: j >= 0 ? round(s.rh[j], 1) : 0,
        firmware: p.firmware,
        hardware: p.hardware,
      },
      risk: {
        level: levelOf(riskScore),
        score: Math.round(riskScore),
        signature: j >= 0 ? nd.analysis.signature[j] : null,
        drivers:
          j >= 0
            ? (['salinity', 'temp', 'turbidity', 'do_sat', 'orp', 'ph'] as Param[])
                .map((q) => ({ param: q, z: round(nd.analysis.z[q][j], 1), delta: round(s.values[q][j] - nd.analysis.baseline[q][j], 3) }))
                .filter((d) => Math.abs(d.z) >= 1.5)
                .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
            : [],
      },
      quality24h: { expected, received, valid, flagged },
      daysSinceCleaning: round((now - lastClean) / D, 1),
      openAlerts,
      spark,
    }
  }

  // ---------- grid ----------

  envNow(): EnvNow {
    const env = this.data().env
    const now = this.now()
    const i = this.envIdx(now)
    const dir = env.windDir[i]
    const ws = env.windMs[i]
    const windName: EnvNow['windName'] =
      ws < 1.5 ? 'calm' : dir >= 15 && dir < 75 && ws > 5 ? 'bura' : dir >= 100 && dir < 170 ? 'jugo' : dir >= 270 && dir < 335 ? 'maestral' : dir >= 335 || dir < 15 ? 'tramontana' : 'other'
    return {
      t: now,
      airTemp: round(env.airTemp[i], 1),
      windMs: round(ws, 1),
      windDir: Math.round(dir),
      windName,
      rain1h: round(this.rainBetween(now - H, now), 1),
      rain24h: round(this.rainBetween(now - 24 * H, now), 1),
      tideM: round(env.tideM[i], 2),
      tideTrend: env.tideM[Math.min(env.grid.n - 1, i + 1)] >= env.tideM[i] ? 'rising' : 'falling',
      hppActive: env.hpp[i] > 0.1,
    }
  }

  grid(): GridResponse {
    const now = this.now()
    const nodes = this.nodeIds().map((id) => this.summary(id))
    const nd1 = this.node('KRD-01')
    const official = nd1.lab.filter((l) => l.source === 'official' && l.t <= now)
    const last = official.at(-1) ?? null
    const y = new Date(now).getUTCFullYear()
    const seasonActive = now >= Date.UTC(y, 4, 15) && now <= Date.UTC(y, 8, 30, 23)
    const next = nd1.lab.find((l) => l.source === 'official' && l.t > now)
    let labPairs = 0
    let orientation = 0
    for (const nd of this.data().nodes.values())
      for (const l of nd.lab) {
        if (l.resultAt > now) continue
        if (l.source === 'reference') labPairs++
        if (l.source === 'orientation') orientation++
      }
    const samples24h = nodes.reduce((a, n) => a + n.quality24h.received, 0)
    const expected24h = nodes.reduce((a, n) => a + n.quality24h.expected, 0)
    const valid = nodes.reduce((a, n) => a + n.quality24h.valid, 0)
    return {
      now,
      site: SITE,
      nodes,
      env: this.envNow(),
      officialSampling: {
        lastAt: last?.t ?? null,
        lastAssessment: last && last.resultAt <= now ? last.assessment : null,
        nextDueAt: seasonActive ? (next?.t ?? null) : null,
        seasonActive,
      },
      landmarks: LANDMARKS,
      stats: {
        samples24h,
        expected24h,
        validPct24h: samples24h ? round((valid / samples24h) * 100, 1) : 0,
        openAlerts: nodes.reduce((a, n) => a + n.openAlerts, 0),
        labPairs,
        orientationAnalyses: orientation,
      },
    }
  }

  // ---------- time series ----------

  private resolutionFor(span: number): { res: Resolution; bucket: number } {
    if (span <= 8 * D) return { res: 'raw', bucket: 0 }
    if (span <= 35 * D) return { res: '1h', bucket: H }
    if (span <= 100 * D) return { res: '3h', bucket: 3 * H }
    return { res: '6h', bucket: 6 * H }
  }

  series(id: string, fromQ: number, toQ: number): SeriesResponse {
    const nd = this.node(id)
    const now = this.now()
    const to = Math.min(toQ, now)
    const from = Math.max(fromQ, this.data().env.grid.start)
    const s = nd.series
    const i0 = this.lower(s.t, from)
    const i1 = this.upper(s.t, to)
    const { res, bucket } = this.resolutionFor(to - from)

    const out: SeriesResponse = {
      node: this.summary(id),
      from,
      to,
      resolution: res,
      t: [],
      qc: [],
      values: Object.fromEntries(PARAMS.map((p) => [p, []])) as unknown as SeriesResponse['values'],
      min: {},
      max: {},
      risk: [],
      baseline: {} as SeriesResponse['baseline'],
      gaps: [],
      rain: this.data().env.rainEvents.filter((r) => r.to >= from && r.from <= to),
      alerts: this.nodeAlerts(nd, now).filter((a) => a.openedAt <= to && (a.closedAt ?? now) >= from),
      lab: this.labFor(nd, now).filter((l) => l.t >= from && l.t <= to),
      maintenance: nd.truth.maintenance.filter((m) => m.t <= to),
      health: { batteryPct: [], rssi: [], snr: [], solarW: [] },
      regimes: [],
    }

    if (res === 'raw') {
      for (let k = i0; k < i1; k++) {
        out.t.push(s.t[k])
        out.qc.push(s.qc[k])
        for (const p of PARAMS) out.values[p].push(round(s.values[p][k], 4))
        out.risk.push(round(nd.analysis.risk[k], 1))
        out.health.batteryPct.push(round(s.battery[k], 1))
        out.health.rssi.push(Math.round(s.rssi[k]))
        out.health.snr.push(round(s.snr[k], 1))
        out.health.solarW.push(round(s.solarW[k], 2))
      }
    } else {
      for (const p of PARAMS) {
        out.min[p] = []
        out.max[p] = []
      }
      let k = i0
      for (let b = Math.floor(from / bucket) * bucket; b < to; b += bucket) {
        const start = k
        while (k < i1 && s.t[k] < b + bucket) k++
        out.t.push(b + bucket / 2)
        if (k === start) {
          out.qc.push(0)
          for (const p of PARAMS) {
            out.values[p].push(null)
            out.min[p]!.push(null)
            out.max[p]!.push(null)
          }
          out.risk.push(null)
          out.health.batteryPct.push(null)
          out.health.rssi.push(null)
          out.health.snr.push(null)
          out.health.solarW.push(null)
          continue
        }
        let qc = 0
        const acc = Object.fromEntries(PARAMS.map((p) => [p, { sum: 0, c: 0, min: Infinity, max: -Infinity }]))
        let risk = 0
        const h = { b: 0, r: 0, sn: 0, so: 0 }
        for (let q = start; q < k; q++) {
          qc |= s.qc[q]
          const bad = s.qc[q] & (QC.SPIKE | QC.RANGE)
          for (const p of PARAMS) {
            if (bad) continue
            const v = s.values[p][q]
            const a = acc[p]
            a.sum += v
            a.c++
            if (v < a.min) a.min = v
            if (v > a.max) a.max = v
          }
          risk = Math.max(risk, nd.analysis.risk[q])
          h.b += s.battery[q]
          h.r += s.rssi[q]
          h.sn += s.snr[q]
          h.so += s.solarW[q]
        }
        const c = k - start
        out.qc.push(qc)
        for (const p of PARAMS) {
          const a = acc[p]
          out.values[p].push(a.c ? round(a.sum / a.c, 4) : null)
          out.min[p]!.push(a.c ? round(a.min, 4) : null)
          out.max[p]!.push(a.c ? round(a.max, 4) : null)
        }
        out.risk.push(round(risk, 1))
        out.health.batteryPct.push(round(h.b / c, 1))
        out.health.rssi.push(Math.round(h.r / c))
        out.health.snr.push(round(h.sn / c, 1))
        out.health.solarW.push(round(h.so / c, 2))
      }
    }

    // Baseline band: P10–P90 of valid samples over the 30 days before the window end.
    const b0 = this.lower(s.t, to - 30 * D)
    for (const p of PARAMS) {
      const vals: number[] = []
      for (let q = b0; q < i1; q += 2) if (!(s.qc[q] & (QC.SPIKE | QC.RANGE | QC.SETTLING))) vals.push(s.values[p][q])
      vals.sort((a, b) => a - b)
      out.baseline[p] = { p10: round(quantile(vals, 0.1), 3), p50: round(quantile(vals, 0.5), 3), p90: round(quantile(vals, 0.9), 3) }
    }

    // Gaps (no data > 1 h), including the pre-deployment period inside the window.
    if (nd.deployedAt > from) out.gaps.push({ from, to: Math.min(nd.deployedAt, to) })
    for (let q = Math.max(i0, 1); q < i1; q++) if (s.t[q] - s.t[q - 1] > H) out.gaps.push({ from: s.t[q - 1], to: s.t[q] })
    if (i1 > 0 && to - s.t[i1 - 1] > H && s.t[i1 - 1] >= from) out.gaps.push({ from: s.t[i1 - 1], to })

    // Water-mass regime segments.
    let cur: { from: number; to: number; regime: Regime } | null = null
    for (let q = i0; q < i1; q++) {
      const r = nd.analysis.regime[q]
      if (cur && (r !== cur.regime || s.t[q] - cur.to > 45 * 60_000)) {
        if (cur.regime !== 'marine' && cur.to - cur.from >= 30 * 60_000) out.regimes.push(cur as SeriesResponse['regimes'][number])
        cur = null
      }
      if (!cur) cur = { from: s.t[q], to: s.t[q], regime: r }
      else cur.to = s.t[q]
    }
    if (cur && cur.regime !== 'marine' && cur.to - cur.from >= 30 * 60_000) out.regimes.push(cur as SeriesResponse['regimes'][number])

    return out
  }

  private labFor(nd: NodeData, now: number): LabSample[] {
    return nd.lab
      .filter((l) => l.t <= now)
      .map((l) => (l.resultAt <= now ? l : { ...l, ecoli: null, enterococci: null, assessment: null }))
  }

  lab(id: string): LabSample[] {
    return this.labFor(this.node(id), this.now()).reverse()
  }

  environment(fromQ: number, toQ: number): EnvSeriesResponse {
    const env = this.data().env
    const now = this.now()
    const to = Math.min(toQ, now)
    const from = Math.max(fromQ, env.grid.start)
    const span = to - from
    const bucket = span <= 3 * D ? H / 2 : span <= 35 * D ? H : 3 * H
    const out: EnvSeriesResponse = { from, to, t: [], rainMm: [], windMs: [], windDir: [], tideM: [], airTemp: [], hpp: [] }
    for (let b = Math.floor(from / bucket) * bucket; b < to; b += bucket) {
      const a0 = this.envIdx(b)
      const a1 = Math.max(a0 + 1, this.envIdx(Math.min(b + bucket, to)))
      let rain = 0
      let w = 0
      let tide = 0
      let air = 0
      let hpp = 0
      let u = 0
      let v = 0
      for (let i = a0; i < a1; i++) {
        rain += env.rainMm[i]
        w += env.windMs[i]
        tide += env.tideM[i]
        air += env.airTemp[i]
        hpp += env.hpp[i]
        u += Math.sin((env.windDir[i] * Math.PI) / 180) * env.windMs[i]
        v += Math.cos((env.windDir[i] * Math.PI) / 180) * env.windMs[i]
      }
      const c = a1 - a0
      out.t.push(b)
      out.rainMm.push(round(rain, 2))
      out.windMs.push(round(w / c, 1))
      out.windDir.push(Math.round(((Math.atan2(u, v) * 180) / Math.PI + 360) % 360))
      out.tideM.push(round(tide / c, 3))
      out.airTemp.push(round(air / c, 1))
      out.hpp.push(round(hpp / c, 2))
    }
    return out
  }

  tsDiagram(id: string, days: number): TsResponse {
    const nd = this.node(id)
    const now = this.now()
    const s = nd.series
    const i0 = this.lower(s.t, now - days * D)
    const i1 = this.upper(s.t, now)
    const counts: Record<Regime, number> = { marine: 0, freshwater: 0, runoff: 0, upwelling: 0 }
    const points: TsResponse['points'] = []
    const stride = days > 14 ? 2 : 1
    for (let q = i0; q < i1; q++) {
      const r = nd.analysis.regime[q]
      counts[r]++
      if (s.qc[q] & (QC.SPIKE | QC.RANGE | QC.SETTLING)) continue
      if (r === 'marine' && q % stride) continue
      points.push({ t: s.t[q], temp: round(s.values.temp[q], 3), salinity: round(s.values.salinity[q], 3), regime: r })
    }
    return { nodeId: id, points, counts }
  }

  compare(param: Param, fromQ: number, toQ: number): CompareResponse {
    const now = this.now()
    const to = Math.min(toQ, now)
    const from = Math.max(fromQ, this.data().env.grid.start)
    const span = to - from
    const bucket = span <= 2 * D ? 15 * 60_000 : span <= 8 * D ? H : span <= 35 * D ? 3 * H : 6 * H
    const res: Resolution = bucket < H ? 'raw' : bucket === H ? '1h' : bucket === 3 * H ? '3h' : '6h'
    const t: number[] = []
    for (let b = Math.floor(from / bucket) * bucket; b < to; b += bucket) t.push(b + bucket / 2)
    const series: Record<string, (number | null)[]> = {}
    for (const nd of this.data().nodes.values()) {
      const s = nd.series
      const arr: (number | null)[] = []
      let k = this.lower(s.t, Math.floor(from / bucket) * bucket)
      const end = this.upper(s.t, to)
      for (const mid of t) {
        const bEnd = mid + bucket / 2
        let sum = 0
        let c = 0
        while (k < end && s.t[k] < bEnd) {
          if (!(s.qc[k] & (QC.SPIKE | QC.RANGE))) {
            sum += s.values[param][k]
            c++
          }
          k++
        }
        arr.push(c ? round(sum / c, 4) : null)
      }
      series[nd.profile.id] = arr
    }
    return { param, from, to, resolution: res, t, series }
  }

  csv(id: string, from: number, to: number, params: Param[]): string {
    const nd = this.node(id)
    const now = this.now()
    const s = nd.series
    const i0 = this.lower(s.t, from)
    const i1 = this.upper(s.t, Math.min(to, now))
    const flagNames = Object.entries(QC)
    const rows = [['timestamp_utc', 'node_id', ...params.map((p) => p), 'risk_index', 'qc_flags'].join(',')]
    for (let k = i0; k < i1; k++) {
      const flags = flagNames.filter(([, bit]) => s.qc[k] & bit).map(([name]) => name.toLowerCase()).join('|')
      rows.push([new Date(s.t[k]).toISOString(), id, ...params.map((p) => s.values[p][k].toFixed(4)), nd.analysis.risk[k].toFixed(1), flags].join(','))
    }
    return rows.join('\n') + '\n'
  }
}

export class NotFound extends Error {}

function count(an: Analysis, now: number, s: NodeSeries, kind: 'freshwater' | 'upwelling') {
  // Count distinct signature runs (≥ 30 min, separated by ≥ 6 h) up to now.
  let runs = 0
  let runStart: number | null = null
  let lastRun = -Infinity
  const end = s.t.length
  for (let j = 0; j < end && s.t[j] <= now; j++) {
    const on = an.signature[j] === kind
    if (on && runStart === null) runStart = s.t[j]
    if (!on && runStart !== null) {
      if (s.t[j] - runStart >= 30 * 60_000 && runStart - lastRun > 6 * H) {
        runs++
        lastRun = runStart
      }
      runStart = null
    }
  }
  return runs
}

function round(x: number, d: number) {
  const f = 10 ** d
  return Math.round(x * f) / f
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return quantile(s, 0.5)
}
