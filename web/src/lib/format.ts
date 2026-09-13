import { PARAM_META, type Param } from '@shared/types'
import type { Key } from './i18n'

export const TZ = 'Europe/Zagreb'
const H = 3_600_000
const D = 86_400_000

type T = (key: Key, vars?: Record<string, string | number>) => string

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>()
const dtf = (locale: string, opts: Intl.DateTimeFormatOptions) => {
  const k = locale + JSON.stringify(opts)
  if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }))
  return cache.get(k) as Intl.DateTimeFormat
}
const nf = (locale: string, min: number, max: number, signed = false) => {
  const k = `${locale}|${min}|${max}|${signed}`
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max, signDisplay: signed ? 'exceptZero' : 'auto' }))
  return cache.get(k) as Intl.NumberFormat
}

export const fmtNum = (locale: string, v: number | null | undefined, decimals = 1, signed = false) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : nf(locale, decimals, decimals, signed).format(v).replace('-', '−')

export const fmtParam = (locale: string, p: Param, v: number | null | undefined, signed = false) => {
  const d = PARAM_META[p].decimals
  return fmtNum(locale, v, p === 'salinity' || p === 'temp' ? Math.min(d, 1) + (signed ? 1 : 0) : d, signed)
}

export const unitOf = (p: Param) => PARAM_META[p].unit

export const fmtTime = (locale: string, t: number) => dtf(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
export const fmtDate = (locale: string, t: number) => dtf(locale, { day: 'numeric', month: 'short' }).format(t)
export const fmtDateTime = (locale: string, t: number) => dtf(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
export const fmtFull = (locale: string, t: number) =>
  dtf(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(t)
export const fmtDay = (locale: string, t: number) => dtf(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(t)

export function fmtDuration(t: T, ms: number) {
  const abs = Math.abs(ms)
  if (abs < 60_000) return t('common.now')
  if (abs < H) return t('common.minutes', { v: Math.round(abs / 60_000) })
  if (abs < 2 * D) return t('common.hours', { v: Math.round(abs / H) })
  return t('common.days', { v: Math.round(abs / D) })
}

export function fmtAgo(t: T, then: number, now = Date.now()) {
  const ms = now - then
  if (ms < 60_000) return t('common.now')
  return t('common.ago', { v: fmtDuration(t, ms) })
}

export function fmtIn(t: T, when: number, now = Date.now()) {
  return t('common.in', { v: fmtDuration(t, when - now) })
}

/** Axis label for ECharts time axes, in Zagreb time, adapting to the visible span. */
export function axisTimeLabel(locale: string, span: number) {
  return (value: number) => {
    const hm = fmtTime(locale, value)
    if (span <= 2 * D) return hm === '00:00' ? fmtDate(locale, value) : hm
    return fmtDate(locale, value)
  }
}
