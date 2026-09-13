import { PARAMS, type Alert, type Assessment, type LabSample, type Values } from '../../shared/types'
import { STEP, localHour, zagrebOffsetH, type Environment } from './environment'
import type { NodeSeries, NodeTruth } from './generate'
import { gaussian, hashString, mulberry32 } from './random'

const H = 3_600_000
const D = 86_400_000

/** Single-sample assessment for coastal bathing water (NN 73/08, Annex I). */
export function assess(ecoli: number, ent: number): Assessment {
  if (ecoli > 300 || ent > 200) return 'poor'
  if (ecoli > 200 || ent > 100) return 'sufficient'
  if (ecoli > 100 || ent > 60) return 'good'
  return 'excellent'
}

/** Local midnight (Europe/Zagreb) at or before t. */
const localMidnight = (t: number) => {
  const off = zagrebOffsetH(t) * H
  return Math.floor((t + off) / D) * D - off
}

function sensorAt(s: NodeSeries, t: number): Values | null {
  let lo = 0
  let hi = s.t.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (s.t[mid] < t) lo = mid + 1
    else hi = mid
  }
  if (!s.t.length || Math.abs(s.t[lo] - t) > H) return null
  return Object.fromEntries(PARAMS.map((p) => [p, Math.round(s.values[p][lo] * 1000) / 1000])) as Values
}

export function buildLab(nodeId: string, s: NodeSeries, truth: NodeTruth, env: Environment, alerts: Alert[], deployedAt: number, seed: number): LabSample[] {
  const rng = mulberry32(seed ^ hashString(nodeId + 'lab'))
  const { grid } = env
  const out: LabSample[] = []
  const end = grid.start + (grid.n - 1) * STEP

  const trueAt = (t: number) => {
    const i = Math.round((t - grid.start) / STEP)
    return i >= 0 && i < grid.n ? truth.ecoli[i] : 10
  }
  const make = (tRaw: number, source: LabSample['source'], trigger: LabSample['trigger'], alertId: string | null): LabSample => {
    const t = Math.round(tRaw / 60_000) * 60_000
    const sigma = source === 'orientation' ? 0.55 : 0.28
    const ec = Math.max(1, Math.round(trueAt(t) * Math.exp(gaussian(rng) * sigma)))
    const ent = Math.max(1, Math.round(trueAt(t) * 0.55 * Math.exp(gaussian(rng) * (sigma + 0.1))))
    const delay = source === 'orientation' ? 20 + rng() * 4 : source === 'official' ? 30 + rng() * 18 : 24 + rng() * 20
    return {
      id: `${nodeId}-${source}-${Math.round(t / 60_000)}`,
      nodeId,
      t,
      resultAt: t + delay * H,
      source,
      trigger,
      ecoli: ec,
      enterococci: ent,
      assessment: assess(ec, ent),
      sensor: sensorAt(s, t),
      alertId,
    }
  }

  const inData = (t: number) => t >= deployedAt + 6 * H && !truth.outages.some((o) => t >= o.from && t < o.to)

  for (let day = localMidnight(deployedAt) + D; day < end; day += D) {
    const dow = new Date(day + zagrebOffsetH(day) * H + 12 * H).getUTCDay()
    // Weekly reference sample (Tuesday morning) for the accredited laboratory.
    if (dow === 2) {
      const t = day + (9 + rng()) * H
      if (inData(t)) out.push(make(t, 'reference', 'routine', null))
    }
    // Orientation analyses by the team (membrane filtration, chromogenic media): Mon / Thu / Sat.
    if (dow === 1 || dow === 4 || dow === 6) {
      const t = day + (10 + rng() * 1.5) * H
      if (inData(t)) out.push(make(t, 'orientation', 'routine', null))
    }
  }

  // Samples triggered by the model: taken at the next daylight opportunity, sent to the reference lab.
  for (const a of alerts) {
    if (a.kind !== 'runoff' && a.kind !== 'organic') continue
    let t = a.openedAt + 1.5 * H
    const h = localHour(t)
    if (h < 7.5) t += (7.5 - h) * H
    else if (h > 18.5) t += (24 - h + 7.5) * H
    if (!inData(t)) continue
    out.push(make(t, 'reference', 'sensor_alert', a.id))
    out.push(make(t + 5 * 60_000, 'orientation', 'sensor_alert', a.id))
  }

  // Official monitoring (IZOR) next to KRD-01: every 15 days, 08:50–10:20, in season, never on or right after a rain day.
  if (nodeId === 'KRD-01') {
    const rainOn = (day: number) => {
      const i0 = Math.max(0, Math.round((day - D - grid.start) / STEP))
      const i1 = Math.min(grid.n - 1, Math.round((day + D - grid.start) / STEP))
      let mm = 0
      for (let i = i0; i <= i1; i++) mm += env.rainMm[i]
      return mm > 0.5
    }
    let day = localMidnight(grid.start + 3 * D)
    while (day < end) {
      const y = new Date(day).getUTCFullYear()
      const seasonStart = Date.UTC(y, 4, 15)
      const seasonEnd = Date.UTC(y, 8, 30, 23)
      if (day >= seasonStart && day <= seasonEnd) {
        let d = day
        while (rainOn(d)) d += D
        const t = d + (8.83 + rng() * 1.5) * H
        const sample = make(t, 'official', 'official', null)
        sample.sensor = inData(t) ? sensorAt(s, t) : null
        out.push(sample)
        day = d + 15 * D
      } else day += D
    }
  }

  return out.sort((a, b) => a.t - b.t)
}
