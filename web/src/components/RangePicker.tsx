import { useState } from 'react'
import { useI18n } from '../lib/i18n'

const D = 86_400_000
export const PRESETS = [
  { key: '24h', ms: D },
  { key: '7d', ms: 7 * D },
  { key: '30d', ms: 30 * D },
  { key: '90d', ms: 90 * D },
] as const

export type PresetKey = (typeof PRESETS)[number]['key']
export type RangeValue = { preset: PresetKey } | { from: number; to: number }

export function resolveRange(r: RangeValue, now: number): { from: number; to: number } {
  if ('preset' in r) {
    const p = PRESETS.find((x) => x.key === r.preset) ?? PRESETS[1]
    // Snap to 5 minutes so polling keeps a stable key between ticks.
    const to = Math.ceil(now / 300_000) * 300_000
    return { from: to - p.ms, to }
  }
  return r
}

export const rangeKey = (r: RangeValue) => ('preset' in r ? r.preset : `${r.from}-${r.to}`)

export function parseRange(search: URLSearchParams): RangeValue {
  const from = Number(search.get('from'))
  const to = Number(search.get('to'))
  if (from && to && from < to) return { from, to }
  const p = search.get('range')
  return { preset: PRESETS.find((x) => x.key === p)?.key ?? '7d' }
}

const toLocalInput = (t: number) => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function RangePicker({ value, onChange, presets = PRESETS.map((p) => p.key) }: { value: RangeValue; onChange: (v: RangeValue) => void; presets?: string[] }) {
  const { t } = useI18n()
  const [custom, setCustom] = useState(!('preset' in value))
  const now = Date.now()
  const r = resolveRange(value, now)
  const [from, setFrom] = useState(toLocalInput(r.from))
  const [to, setTo] = useState(toLocalInput(r.to))

  return (
    <div className="toolbar-group" role="group" aria-label={t('node.range')}>
      <div className="seg">
        {PRESETS.filter((p) => presets.includes(p.key)).map((p) => (
          <button
            key={p.key}
            aria-pressed={!custom && 'preset' in value && value.preset === p.key}
            onClick={() => {
              setCustom(false)
              onChange({ preset: p.key })
            }}
          >
            {p.key}
          </button>
        ))}
        <button aria-pressed={custom} onClick={() => setCustom(true)}>
          {t('node.custom')}
        </button>
      </div>
      {custom && (
        <form
          className="toolbar-group"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new Date(`${from}T00:00`).getTime()
            const tt = new Date(`${to}T23:59:59`).getTime()
            if (f && tt && f < tt) onChange({ from: f, to: Math.min(tt, Date.now()) })
          }}
        >
          <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 6 }}>
            {t('node.from')}
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field" style={{ gridAutoFlow: 'column', alignItems: 'center', gap: 6 }}>
            {t('node.to')}
            <input className="input" type="date" value={to} min={from} max={toLocalInput(now)} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button className="btn" data-size="sm" type="submit">
            {t('node.apply')}
          </button>
        </form>
      )}
    </div>
  )
}
