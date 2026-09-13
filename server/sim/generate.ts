import { PARAM_META, PARAMS, QC, type Param } from '../../shared/types'
import { STEP, localHour, dayOfYear, type Environment } from './environment'
import { ar1, clamp, gaussian, hashString, mulberry32, pulse } from './random'
import { conductivityFromSalinity, oxygenSolubilityMgL } from './seawater'
import { DECOY_EVENTS, DRY_EPISODES, MAINTENANCE, OUTAGES, RAIN_RESPONSE, type Episode, type NodeProfile } from './site'

const H = 3_600_000
const D = 86_400_000

/** Emitted samples of one node — what the shore gateway actually received. */
export interface NodeSeries {
  t: Float64Array
  qc: Uint8Array
  values: Record<Param, Float32Array>
  battery: Float32Array
  batteryV: Float32Array
  solarW: Float32Array
  rssi: Float32Array
  snr: Float32Array
  rh: Float32Array
  /** Grid index of each sample, for joining with the environment. */
  gi: Uint32Array
  /** Packets the node transmitted but the gateway never received. */
  lost: Float64Array
}

export interface NodeTruth {
  /** Hidden E. coli concentration on the 5-minute grid (cfu/100 mL). */
  ecoli: Float32Array
  episodes: Episode[]
  outages: { from: number; to: number; cause: string }[]
  maintenance: { t: number; kind: 'deploy' | 'cleaning' | 'calibration' | 'sensor_swap' | 'hw_upgrade'; note: string }[]
}

export function generateNode(node: NodeProfile, env: Environment, seed: number): { series: NodeSeries; truth: NodeTruth } {
  const { grid } = env
  const { n, start, anchor } = grid
  const rng = mulberry32(seed ^ hashString(node.id))
  const k = node.k

  const deployedAt = anchor + node.deployedAt
  const maintenance = MAINTENANCE[node.id].map((m) => ({ t: anchor + m.at, kind: m.kind, note: m.note }))
  const cleanings = maintenance.filter((m) => m.kind === 'cleaning' || m.kind === 'deploy' || m.kind === 'hw_upgrade' || m.kind === 'sensor_swap').map((m) => m.t)
  const outages = OUTAGES[node.id].map((o) => ({ from: anchor + o.at, to: anchor + o.at + o.durH * H, cause: o.cause }))

  // Hidden truth: episodes from dry-weather incidents plus rain-driven overflows.
  const resp = RAIN_RESPONSE[node.id]
  const episodes: Episode[] = [
    ...DRY_EPISODES.filter((e) => e.nodeId === node.id).map((e) => ({ ...e, at: anchor + e.at })),
    ...env.rainEvents
      .filter((ev) => ev.mm >= resp.minMm)
      .map((ev) => ({
        nodeId: node.id,
        at: ev.from + 2 * H,
        durH: 8 + ev.mm * 0.5,
        peak: Math.round(ev.mm * 32 * resp.weight * (0.8 + rng() * 0.5)),
        signature: 0.45,
        cause: 'rain' as const,
      })),
  ].filter((e) => e.at + e.durH * H > deployedAt)
  const decoys = DECOY_EVENTS.filter((e) => e.nodeId === node.id).map((e) => ({ ...e, at: anchor + e.at }))

  // Slow, independent wander for each water property.
  const wS = ar1(rng, n, 0.9993, 0.22)
  const wT = ar1(rng, n, 0.9995, 0.35)
  const wPh = ar1(rng, n, 0.998, 0.018)
  const wOrp = ar1(rng, n, 0.998, 10)
  const wTurb = ar1(rng, n, 0.99, 0.18)
  const wDo = ar1(rng, n, 0.995, 2.2)
  const wRssi = ar1(rng, n, 0.99, 2.0)

  const ecoli = new Float32Array(n)
  const temp = new Float32Array(n)
  const sal = new Float32Array(n)
  const ph = new Float32Array(n)
  const doSat = new Float32Array(n)
  const turb = new Float32Array(n)
  const orp = new Float32Array(n)
  const battery = new Float32Array(n)
  const solarW = new Float32Array(n)

  let plume = 0
  let runoffStore = 0
  let runoff = 0
  let upwell = 0
  let waves = 0
  let soc = 88
  let lastRain = start - 10 * D

  const eAlpha = (tauMin: number) => 1 - Math.exp(-5 / tauMin)

  for (let i = 0; i < n; i++) {
    const t = start + i * STEP
    const hour = localHour(t)
    const doy = dayOfYear(t)
    if (env.rainMm[i] > 0.05) lastRain = t

    // --- forcings filtered to the micro-location ---
    const flowIn = env.hpp[i] * (1 - 0.5 * env.bora[i]) * (1 + 0.25 * Math.max(0, -env.tideM[i]) * 4)
    plume += (flowIn - plume) * (flowIn > plume ? eAlpha(35) : eAlpha(80))
    runoffStore += env.rainMm[i]
    const out = runoffStore * eAlpha(240)
    runoffStore -= out
    runoff += (out - runoff) * eAlpha(45)
    upwell += (env.bora[i] - upwell) * eAlpha(8 * 60)
    const waveForce = Math.max(0, env.windMs[i] - 5) ** 1.5 * (env.jugo[i] > env.bora[i] ? 1 : 0.35)
    waves += (waveForce - waves) * eAlpha(120)

    // Hidden bacteriological load.
    let eco = 8 + 10 * Math.max(0, Math.sin(((hour - 10) / 12) * Math.PI)) + Math.abs(wOrp[i]) * 0.6
    let org = 0
    for (const ep of episodes) {
      const dtH = (t - ep.at) / H
      if (dtH < 0 || dtH > ep.durH + 48) continue
      const shape = dtH <= ep.durH ? pulse(dtH, 3, 1e9) : Math.exp(-(dtH - ep.durH) / 6)
      const conc = ep.peak * shape
      eco += conc
      org = Math.max(org, ep.signature * clamp(Math.log10(1 + conc / 40) / 1.4, 0, 1))
    }
    ecoli[i] = eco
    org *= k.organic
    for (const dc of decoys) {
      const dtH = (t - dc.at) / H
      if (dtH >= 0 && dtH < dc.durH + 36) org = Math.max(org, dc.strength * (dtH <= dc.durH ? pulse(dtH, 4, 1e9) : Math.exp(-(dtH - dc.durH) / 5)))
    }

    // --- marine end-member ---
    const seasonal = 18.5 + 7.2 * Math.cos((2 * Math.PI * (doy - 222)) / 365)
    let tSea = seasonal + wT[i] + 0.35 * (1 + k.warm) * Math.sin(((hour - 9) / 24) * 2 * Math.PI) - upwell * 3.8 * k.upwelling
    let sSea = 37.95 + wS[i] - 0.35 * k.fresh + upwell * 0.45 * k.upwelling
    const photo = Math.sin(((hour - 10) / 24) * 2 * Math.PI)
    let phSea = 8.15 + wPh[i] + 0.025 * photo + 0.02 * upwell
    let doSea = 101 + 6.5 * photo + wDo[i] + 3 * upwell
    let turbSea = 0.65 + 0.3 * k.waves + Math.abs(wTurb[i]) + waves * 0.22 * k.waves
    let orpSea = 208 + wOrp[i]

    // --- mixing with freshwater from the karst hydro plant (cold, clear, fresh) ---
    const fH = clamp(plume * k.fresh * 0.34, 0, 0.45)
    tSea = tSea * (1 - fH) + 13.2 * fH
    sSea = sSea * (1 - fH) + 0.3 * fH
    phSea = phSea * (1 - fH) + 7.65 * fH
    doSea = doSea * (1 - fH) + 103 * fH
    turbSea = turbSea * (1 - fH) + 0.25 * fH
    orpSea = orpSea * (1 - fH) + 240 * fH

    // --- storm runoff (fresh, turbid, warm-ish, slightly acidic) ---
    const dryDays = (t - lastRain) / D
    const fR = clamp(runoff * k.runoff * 0.19 * (1 + Math.min(dryDays, 20) * 0.01), 0, 0.14)
    const tAir = env.airTemp[i]
    tSea = tSea * (1 - fR) + tAir * fR
    sSea = sSea * (1 - fR) + 0.2 * fR
    phSea = phSea * (1 - fR) + 7.25 * fR
    doSea = doSea * (1 - fR) + 82 * fR
    turbSea = turbSea * (1 - fR) + 115 * fR
    orpSea = orpSea * (1 - fR) + 120 * fR

    // --- organic load (sewage): no salinity footprint to speak of, oxygen demand and reducing conditions ---
    doSea -= org * 24
    orpSea -= org * 115
    turbSea += org * 3.2
    phSea -= org * 0.09
    sSea -= org * 0.12

    // --- biofouling drift since last cleaning ---
    let lastClean = deployedAt
    for (const c of cleanings) if (c <= t) lastClean = c
    const dc = Math.max(0, (t - lastClean) / D)
    turbSea += 0.0042 * dc * dc
    doSea -= 0.34 * dc
    orpSea -= 1.1 * dc
    phSea -= 0.0014 * dc

    temp[i] = tSea
    sal[i] = Math.max(0, sSea)
    ph[i] = phSea
    doSat[i] = Math.max(0, doSea)
    turb[i] = Math.max(0.05, turbSea)
    orp[i] = orpSea

    // --- power budget ---
    let eff = node.solarEff
    if (node.id === 'KRD-03' && t > anchor - 44 * D && t < anchor - 37.6 * D) eff *= 0.12 // gull droppings on the panel
    const panelW = 10 * eff * (env.solar[i] / 1000) * 0.82
    solarW[i] = panelW
    const loadW = 0.33 + (fR > 0.02 || org > 0.2 ? 0.14 : 0)
    soc = clamp(soc + ((panelW - loadW) * (5 / 60) * 0.92 * 100) / 60, 0, 100)
    if (node.id === 'KRD-03' && Math.abs(t - (anchor - 37.6 * D + 22 * H)) < STEP) soc = 34
    battery[i] = soc
  }

  // --- emission: what the node samples and what the gateway receives ---
  const outT: number[] = []
  const outQc: number[] = []
  const outGi: number[] = []
  const lost: number[] = []
  const trig = { s: sal[0], turb: turb[0], do: doSat[0] }
  let adaptiveUntil = 0

  for (let i = 0; i < n; i++) {
    const t = start + i * STEP
    // On-board running references (EMA ~24 h) for the adaptive 15/5-minute interval.
    trig.s += (sal[i] - trig.s) * eAlpha(1440)
    trig.turb += (turb[i] - trig.turb) * eAlpha(1440)
    trig.do += (doSat[i] - trig.do) * eAlpha(1440)
    if (t < deployedAt) continue
    if (outages.some((o) => t >= o.from && t < o.to)) continue
    if (battery[i] < 3) continue

    const deviating = Math.abs(sal[i] - trig.s) > 1.5 || turb[i] > trig.turb * 2.5 + 1.5 || doSat[i] < trig.do - 10
    if (deviating) adaptiveUntil = t + 2 * H
    const minute = Math.round(t / 60_000) % 60
    const onQuarter = minute % 15 === 0
    const adaptive = t < adaptiveUntil
    if (!onQuarter && !adaptive) continue

    // Link budget: weaker SNR loses more packets; jugo waves shadow the antenna.
    const snr = node.radio.snr + gaussian(rng) * 1.2 - env.jugo[i] * 3 - env.rainMm[i] * 0.8
    const pLoss = 0.012 + Math.max(0, 3 - snr) * 0.015
    let qc = adaptive && !onQuarter ? QC.ADAPTIVE : 0
    if (rng() < pLoss) {
      if (rng() < 0.72) qc |= QC.BACKFILL
      else {
        lost.push(t)
        continue
      }
    }
    outT.push(t)
    outQc.push(qc)
    outGi.push(i)
  }

  const m = outT.length
  const values = Object.fromEntries(PARAMS.map((p) => [p, new Float32Array(m)])) as Record<Param, Float32Array>
  const series: NodeSeries = {
    t: Float64Array.from(outT),
    qc: Uint8Array.from(outQc),
    values,
    battery: new Float32Array(m),
    batteryV: new Float32Array(m),
    solarW: new Float32Array(m),
    rssi: new Float32Array(m),
    snr: new Float32Array(m),
    rh: new Float32Array(m),
    gi: Uint32Array.from(outGi),
    lost: Float64Array.from(lost),
  }

  for (let j = 0; j < m; j++) {
    const i = outGi[j]
    const t = outT[j]
    let qc = outQc[j]
    const T = temp[i] + gaussian(rng) * 0.012
    const S = sal[i] + gaussian(rng) * 0.025
    let turbidity = turb[i] * (1 + gaussian(rng) * 0.04) + gaussian(rng) * 0.05
    if (rng() < 0.0016) turbidity += 6 + rng() * 22 // debris or a fish passing the optical window
    const dS = doSat[i] + gaussian(rng) * 0.7
    const mgl = (dS / 100) * oxygenSolubilityMgL(T, S)

    values.temp[j] = T
    values.salinity[j] = S
    values.conductivity[j] = conductivityFromSalinity(S, T) + gaussian(rng) * 0.03
    values.ph[j] = ph[i] + gaussian(rng) * 0.007
    values.do_sat[j] = dS
    values.do_mgl[j] = mgl
    values.turbidity[j] = Math.max(0.02, turbidity)
    values.orp[j] = orp[i] + gaussian(rng) * 2.5

    // Post-maintenance settling period.
    if (maintenance.some((mm) => t >= mm.t && t < mm.t + 3 * H)) qc |= QC.SETTLING
    for (const p of PARAMS) {
      const [lo, hi] = PARAM_META[p].range
      if (values[p][j] < lo || values[p][j] > hi) qc |= QC.RANGE
    }
    series.qc[j] = qc

    series.battery[j] = battery[i]
    series.batteryV[j] = 3.35 + battery[i] * 0.0085 + gaussian(rng) * 0.005
    series.solarW[j] = solarW[i]
    series.rssi[j] = node.radio.rssi + wRssi[i] - env.jugo[i] * 4 - env.rainMm[i] * 1.5
    series.snr[j] = node.radio.snr + wRssi[i] * 0.4 - env.jugo[i] * 3
    series.rh[j] = 24 + (t - deployedAt) / D * 0.09 + (temp[i] - 22) * 0.6
  }

  // QC: spike detection on turbidity with a 5-sample median filter.
  const tv = values.turbidity
  for (let j = 2; j < m - 2; j++) {
    const win = [tv[j - 2], tv[j - 1], tv[j + 1], tv[j + 2]].sort((a, b) => a - b)
    const med = (win[1] + win[2]) / 2
    if (tv[j] > med * 3 + 2) series.qc[j] |= QC.SPIKE
  }

  return { series, truth: { ecoli, episodes, outages, maintenance } }
}
