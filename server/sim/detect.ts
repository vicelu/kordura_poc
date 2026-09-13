import { PARAMS, QC, type Alert, type AlertKind, type Driver, type Param, type Regime, type RiskLevel } from '../../shared/types'
import { STEP, type Environment } from './environment'
import type { NodeSeries } from './generate'

const H = 3_600_000
const D = 86_400_000

/** Minimum robust scale per parameter, so a very quiet sensor does not produce huge z-scores. */
const MIN_SCALE: Record<Param, number> = {
  temp: 0.3,
  salinity: 0.3,
  conductivity: 0.4,
  ph: 0.03,
  do_sat: 3,
  do_mgl: 0.25,
  turbidity: 0.45,
  orp: 12,
}

export interface Analysis {
  z: Record<Param, Float32Array>
  baseline: Record<Param, Float32Array>
  risk: Float32Array
  signature: (AlertKind | null)[]
  regime: Regime[]
  rain24: Float32Array
  alerts: Alert[]
}

export const levelOf = (score: number): RiskLevel => (score >= 65 ? 'high' : score >= 40 ? 'elevated' : score >= 20 ? 'watch' : 'normal')

export function analyse(nodeId: string, s: NodeSeries, env: Environment, cleanings: number[]): Analysis {
  const m = s.t.length
  const z = Object.fromEntries(PARAMS.map((p) => [p, new Float32Array(m)])) as Record<Param, Float32Array>
  const baseline = Object.fromEntries(PARAMS.map((p) => [p, new Float32Array(m)])) as Record<Param, Float32Array>
  const risk = new Float32Array(m)
  const signature: (AlertKind | null)[] = new Array(m).fill(null)
  const regime: Regime[] = new Array(m).fill('marine')
  const rain24 = new Float32Array(m)

  // Cumulative rain for fast 24 h windows.
  const cum = new Float64Array(env.grid.n + 1)
  for (let i = 0; i < env.grid.n; i++) cum[i + 1] = cum[i] + env.rainMm[i]
  const perDay = Math.round(D / STEP)

  // Robust, self-gating baselines: EMA that only learns from non-anomalous samples.
  const base: Record<string, number> = {}
  const scale: Record<string, number> = {}
  const smooth: Record<string, number> = {}
  for (const p of PARAMS) {
    base[p] = s.values[p][0]
    scale[p] = MIN_SCALE[p]
    smooth[p] = 0
  }
  let riskSmooth = 0
  let prevT = s.t[0]

  for (let j = 0; j < m; j++) {
    const t = s.t[j]
    const dtMin = Math.max(5, (t - prevT) / 60_000)
    prevT = t
    const gi = s.gi[j]
    rain24[j] = cum[gi + 1] - cum[Math.max(0, gi + 1 - perDay)]

    const warm = j < 96 // first day after deployment: learn quickly, do not alarm
    let lastClean = 0
    for (const c of cleanings) if (c <= t) lastClean = c
    const dc = (t - lastClean) / D
    if (dc > 14) s.qc[j] |= QC.DRIFT

    for (const p of PARAMS) {
      const x = s.values[p][j]
      const sc = Math.max(scale[p] * 1.4826, MIN_SCALE[p])
      const r = (x - base[p]) / sc
      const flagged = (s.qc[j] & (QC.SPIKE | QC.RANGE | QC.SETTLING)) !== 0
      const aB = 1 - Math.exp(-dtMin / (warm ? 60 : 36 * 60))
      const aS = 1 - Math.exp(-dtMin / (warm ? 120 : 5 * 24 * 60))
      // Salinity tracks the marine envelope: learn quickly upwards, so recurring freshwater pulses do not drag the baseline down.
      const upward = (p === 'salinity' || p === 'conductivity') && x > base[p] && !warm
      if (!flagged && (Math.abs(r) < 3 || warm || upward)) base[p] += (x - base[p]) * (upward ? 1 - Math.exp(-dtMin / 360) : aB)
      if (!flagged) scale[p] = Math.min(scale[p] + (Math.min(Math.abs(x - base[p]), sc * 3) - scale[p]) * aS, MIN_SCALE[p] * 2.5)
      const aZ = 1 - Math.exp(-dtMin / 30)
      smooth[p] += ((flagged ? smooth[p] : r) - smooth[p]) * aZ
      z[p][j] = warm ? 0 : smooth[p]
      baseline[p][j] = base[p]
    }

    const zS = z.salinity[j]
    const zTu = z.turbidity[j]
    const zDo = z.do_sat[j]
    const zO = z.orp[j]
    const r24 = rain24[j]

    let sig: AlertKind | null = null
    let score = 0
    const organic = Math.max(0, -zDo - 2) * 7 + Math.max(0, -zO - 2) * 6.5 + Math.max(0, zTu - 2) * 2.5
    const runoff = r24 >= 5 ? (Math.max(0, -zS - 1) * 4 + Math.max(0, zTu - 2) * 4.5 + Math.max(0, -zDo - 1.5) * 4) * Math.min(1, r24 / 15) : 0

    const dS = s.values.salinity[j] - baseline.salinity[j]
    const dT = s.values.temp[j] - baseline.temp[j]
    if (dS < -1.2 && dT < -0.25 && zTu < 1.5 && r24 < 3) {
      sig = 'freshwater'
      score = 8 + organic * 0.3
      regime[j] = 'freshwater'
    } else if (runoff > organic && runoff > 12) {
      sig = 'runoff'
      score = runoff
      regime[j] = 'runoff'
    } else if (organic > 12) {
      sig = 'organic'
      score = organic
    } else if (dT < -1.2 && dS > 0.15) {
      sig = 'upwelling'
      score = 5
      regime[j] = 'upwelling'
    } else {
      score = Math.max(organic, runoff) * 0.8
      if (dS < -1.2 && r24 >= 3) regime[j] = 'runoff'
      else if (dS < -1.2) regime[j] = 'freshwater'
    }
    riskSmooth += (Math.min(100, score) - riskSmooth) * (1 - Math.exp(-dtMin / 45))
    risk[j] = riskSmooth
    signature[j] = sig
  }

  // --- alert episodes ---
  const alerts: Alert[] = []
  let open: Alert | null = null
  let calmSince: number | null = null
  let sigRun = null as { kind: AlertKind; since: number } | null

  const driversAt = (j: number): Driver[] =>
    (['salinity', 'temp', 'turbidity', 'do_sat', 'orp', 'ph'] as Param[])
      .map((p) => ({ param: p, z: Math.round(z[p][j] * 10) / 10, delta: Math.round((s.values[p][j] - baseline[p][j]) * 100) / 100 }))
      .filter((d) => Math.abs(d.z) >= 1.5)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 4)

  for (let j = 0; j < m; j++) {
    const t = s.t[j]
    const sig = signature[j]
    if (sig !== sigRun?.kind) sigRun = sig ? { kind: sig, since: t } : null

    const lvl = levelOf(risk[j])
    if (!open) {
      if ((sig === 'runoff' || sig === 'organic') && (lvl === 'elevated' || lvl === 'high') && sigRun && t - sigRun.since >= 30 * 60_000) {
        open = {
          id: `${nodeId}-${sig}-${Math.round(t / 60_000)}`,
          nodeId,
          kind: sig,
          severity: lvl,
          openedAt: t,
          closedAt: null,
          peakScore: Math.round(risk[j]),
          drivers: driversAt(j),
          rainMm24h: Math.round(rain24[j] * 10) / 10,
          state: 'open',
          ack: null,
          verdict: null,
          leadTimeH: null,
        }
        calmSince = null
      }
    } else {
      if (risk[j] > open.peakScore) {
        open.peakScore = Math.round(risk[j])
        open.severity = levelOf(risk[j])
        open.drivers = driversAt(j)
        open.rainMm24h = Math.max(open.rainMm24h, Math.round(rain24[j] * 10) / 10)
      }
      if (risk[j] < 20) {
        calmSince ??= t
        if (t - calmSince >= 3 * H) {
          open.closedAt = t
          alerts.push(open)
          open = null
        }
      } else calmSince = null
    }
  }
  if (open) alerts.push(open)

  // Drift: the DO sensor keeps sliding down while neighbours hold steady — flagged from 14 days after cleaning.
  const lastClean = Math.max(...cleanings.filter((c) => c <= s.t[m - 1]))
  const driftAt = lastClean + 14 * D
  if (m && s.t[m - 1] > driftAt) {
    alerts.push({
      id: `${nodeId}-drift-${Math.round(driftAt / 60_000)}`,
      nodeId,
      kind: 'drift',
      severity: 'watch',
      openedAt: driftAt,
      closedAt: null,
      peakScore: 0,
      drivers: [],
      rainMm24h: 0,
      state: 'open',
      ack: null,
      verdict: null,
      leadTimeH: null,
    })
  }

  // Communication gaps longer than 2 h.
  for (let j = 1; j < m; j++) {
    if (s.t[j] - s.t[j - 1] > 2 * H) {
      alerts.push({
        id: `${nodeId}-comms-${Math.round(s.t[j - 1] / 60_000)}`,
        nodeId,
        kind: s.battery[j - 1] < 10 ? 'battery' : 'comms',
        severity: 'watch',
        openedAt: s.t[j - 1] + 45 * 60_000,
        closedAt: s.t[j],
        peakScore: 0,
        drivers: [],
        rainMm24h: 0,
        state: 'closed',
        ack: null,
        verdict: null,
        leadTimeH: null,
      })
    }
  }

  alerts.sort((a, b) => b.openedAt - a.openedAt)
  return { z, baseline, risk, signature, regime, rain24, alerts }
}
