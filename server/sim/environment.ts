import { ar1, clamp, gaussian, mulberry32, pulse } from './random'
import { RAIN_EVENTS, WIND_EPISODES } from './site'

export const STEP = 5 * 60_000
const H = 3_600_000
const D = 86_400_000

export interface Grid {
  start: number
  n: number
  anchor: number
}

export interface Environment {
  grid: Grid
  rainMm: Float32Array // mm per 5-min step
  windMs: Float32Array
  windDir: Float32Array
  bora: Float32Array // 0–1 intensity
  jugo: Float32Array
  tideM: Float32Array
  airTemp: Float32Array
  solar: Float32Array // W/m² global horizontal
  hpp: Float32Array // 0–1 relative discharge of the Zavrelje hydro plant
  rainEvents: { from: number; to: number; mm: number }[]
}

/** Central European (Zagreb) UTC offset in hours, honouring EU DST rules. */
export function zagrebOffsetH(t: number): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(y, month + 1, 0, 1))
    return last.getTime() - last.getUTCDay() * D
  }
  return t >= lastSunday(2) && t < lastSunday(9) ? 2 : 1
}

export const localHour = (t: number) => {
  const h = (t / H + zagrebOffsetH(t)) % 24
  return h < 0 ? h + 24 : h
}

export const dayOfYear = (t: number) => {
  const d = new Date(t)
  return (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / D
}

export function buildEnvironment(anchor: number, start: number, end: number, seed: number): Environment {
  const n = Math.floor((end - start) / STEP) + 1
  const rng = mulberry32(seed ^ 0x51ed)
  const grid: Grid = { start, n, anchor }

  const rainMm = new Float32Array(n)
  const windMs = new Float32Array(n)
  const windDir = new Float32Array(n)
  const bora = new Float32Array(n)
  const jugo = new Float32Array(n)
  const tideM = new Float32Array(n)
  const airTemp = new Float32Array(n)
  const solar = new Float32Array(n)
  const hpp = new Float32Array(n)

  const cloudNoise = ar1(rng, n, 0.999, 0.25)
  const windNoise = ar1(rng, n, 0.995, 1.1)
  const surge = ar1(rng, n, 0.9995, 0.05)

  const rainEvents = RAIN_EVENTS.map((e) => ({ from: anchor + e.at, to: anchor + e.at + e.durH * H, mm: e.mm }))

  // Rain: each event distributed with a skewed intensity profile and a little intra-event gustiness.
  for (const ev of rainEvents) {
    const i0 = Math.max(0, Math.floor((ev.from - start) / STEP))
    const i1 = Math.min(n - 1, Math.ceil((ev.to - start) / STEP))
    const w: number[] = []
    for (let i = i0; i <= i1; i++) {
      const x = (i - i0) / Math.max(1, i1 - i0)
      w.push(Math.pow(x, 0.8) * Math.pow(1 - x, 2.2) * (0.5 + rng()))
    }
    const sum = w.reduce((a, b) => a + b, 0) || 1
    for (let i = i0; i <= i1; i++) rainMm[i] += (ev.mm * w[i - i0]) / sum
  }

  for (let i = 0; i < n; i++) {
    const t = start + i * STEP
    const hour = localHour(t)
    const doy = dayOfYear(t)

    // Wind episodes.
    let b = 0
    let j = 0
    for (const ep of WIND_EPISODES) {
      const dtH = (t - (anchor + ep.at)) / H
      if (dtH < -6 || dtH > ep.durH + 24) continue
      const shape = dtH < 0 ? 0 : pulse(dtH, Math.min(10, ep.durH / 3), ep.durH / 2.5) * (dtH > ep.durH ? Math.exp(-(dtH - ep.durH) / 4) : 1)
      if (ep.kind === 'bura') b = Math.max(b, (shape * ep.peak) / 18)
      else j = Math.max(j, (shape * ep.peak) / 12)
    }
    bora[i] = b
    jugo[i] = j

    // Afternoon maestral sea breeze from NW, suppressed during synoptic winds.
    const breeze = Math.max(0, Math.sin(((hour - 10) / 10) * Math.PI)) * 4.2 * (1 - Math.max(b, j))
    const gust = b > 0.05 ? Math.abs(gaussian(rng)) * 3 * b : 0
    const ws = clamp(breeze + b * 18 + j * 12 + gust + 0.8 + windNoise[i] * 0.6, 0, 32)
    windMs[i] = ws
    const dirBase = b > 0.3 ? 40 : j > 0.3 ? 130 : breeze > 1.5 ? 305 : 20 + 60 * Math.sin(i / 300)
    windDir[i] = (dirBase + windNoise[i] * 12 + 360) % 360

    // Adriatic mixed tide (M2, S2, K1, O1) plus meteorological residual (jugo raises sea level).
    const th = t / H
    tideM[i] =
      0.115 * Math.cos((2 * Math.PI * th) / 12.4206 + 1.1) +
      0.07 * Math.cos((2 * Math.PI * th) / 12 + 0.4) +
      0.085 * Math.cos((2 * Math.PI * th) / 23.9345 + 2.0) +
      0.045 * Math.cos((2 * Math.PI * th) / 25.8193 + 0.7) +
      surge[i] + j * 0.18 - b * 0.08

    // Clouds and solar radiation (lat 42.6°N).
    let rainNear = 0
    for (const ev of rainEvents) {
      if (t > ev.from - 8 * H && t < ev.to + 6 * H) rainNear = 1
    }
    const cloud = clamp(0.12 + cloudNoise[i] * 0.4 + rainNear * 0.75 + j * 0.3 - b * 0.2, 0, 0.95)
    const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81))
    const hourAngle = (hour - 12.4) * 15
    const rad = Math.PI / 180
    const elev = Math.asin(Math.sin(42.62 * rad) * Math.sin(decl * rad) + Math.cos(42.62 * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad))
    solar[i] = Math.max(0, 1050 * Math.sin(elev)) * (1 - 0.78 * cloud)

    // Air temperature: seasonal, diurnal, bura chill, rain cooling.
    const seasonal = 17.5 + 8.5 * Math.cos((2 * Math.PI * (doy - 205)) / 365)
    const diurnal = 3.8 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)
    airTemp[i] = seasonal + diurnal * (1 - cloud * 0.6) - b * 6 - rainNear * 2.5 + windNoise[i] * 0.3
  }

  // Hydro plant schedule: morning and evening windows, stronger for days after rain (karst spring response).
  for (let i = 0; i < n; i++) {
    const t = start + i * STEP
    const hour = localHour(t)
    const dow = new Date(t + zagrebOffsetH(t) * H).getUTCDay()
    let wet = 0
    for (const ev of rainEvents) {
      const dtD = (t - ev.to) / D
      if (dtD > 0 && dtD < 6) wet = Math.max(wet, (ev.mm / 38) * Math.exp(-dtD / 2.2))
    }
    const dayRng = mulberry32(Math.floor((t + zagrebOffsetH(t) * H) / D) ^ seed)
    const morning = dow !== 0 && dow !== 6 && dayRng() > 0.2
    const flowM = 0.55 + 0.35 * dayRng()
    const flowE = 0.5 + 0.4 * dayRng()
    const eStart = 17.5 + dayRng() * 1.5
    let f = 0
    if (morning && hour >= 5.5 && hour < 9.5) f = flowM
    if (hour >= eStart && hour < eStart + 3.5 + wet * 4) f = Math.max(f, flowE)
    if (wet > 0.35) f = Math.max(f, 0.3 + wet * 0.6)
    hpp[i] = clamp(f, 0, 1)
  }

  return { grid, rainMm, windMs, windDir, bora, jugo, tideM, airTemp, solar, hpp, rainEvents }
}

/** Index of a timestamp on the 5-minute grid. */
export const idx = (g: Grid, t: number) => Math.round((t - g.start) / STEP)
