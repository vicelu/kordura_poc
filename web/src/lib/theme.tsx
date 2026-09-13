import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface ChartTokens {
  dark: boolean
  surface: string
  ink: string
  ink2: string
  muted: string
  grid: string
  axis: string
  line: string
  lineSoft: string
  band: string
  wash: string
  series: [string, string, string]
  seriesSoft: [string, string, string]
  status: { good: string; warning: string; serious: string; critical: string }
  font: string
  mono: string
}

interface ThemeCtx {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
  tokens: ChartTokens
}

const Ctx = createContext<ThemeCtx | null>(null)

const readMode = (): ThemeMode => {
  try {
    const v = localStorage.getItem('kordura.theme')
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false

function readTokens(dark: boolean): ChartTokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    dark,
    surface: v('--surface'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--muted'),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    line: v('--data-line'),
    lineSoft: v('--data-line-soft'),
    band: v('--chart-band'),
    wash: v('--chart-wash'),
    series: [v('--series-1'), v('--series-2'), v('--series-3')],
    seriesSoft: [v('--series-1-soft'), v('--series-2-soft'), v('--series-3-soft')],
    status: { good: v('--status-good'), warning: v('--status-warning'), serious: v('--status-serious'), critical: v('--status-critical') },
    font: v('--font-ui'),
    mono: v('--font-mono'),
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const [sysDark, setSysDark] = useState(systemDark)
  const resolved = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode
  const [tokens, setTokens] = useState<ChartTokens>(() => readTokens(resolved === 'dark'))

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = () => setSysDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (mode === 'system') delete root.dataset.theme
    else root.dataset.theme = mode
    // Read after the attribute has been applied.
    requestAnimationFrame(() => setTokens(readTokens(resolved === 'dark')))
  }, [mode, resolved])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try {
      if (m === 'system') localStorage.removeItem('kordura.theme')
      else localStorage.setItem('kordura.theme', m)
    } catch {
      /* storage unavailable */
    }
  }, [])

  const value = useMemo(() => ({ mode, resolved, setMode, tokens }), [mode, resolved, setMode, tokens])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme outside provider')
  return ctx
}
