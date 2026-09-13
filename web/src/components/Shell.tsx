import type { GridResponse } from '@shared/types'
import { createContext, useContext, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { api, usePolling, type Resource } from '../lib/api'
import { fmtTime } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useTheme, type ThemeMode } from '../lib/theme'
import { IconLang, IconMonitor, IconMoon, IconSun } from './Icons'

/** The grid summary is polled once for the whole app: the top bar, overview and node pages all read it. */
const GridCtx = createContext<Resource<GridResponse> | null>(null)
export const useGrid = () => {
  const ctx = useContext(GridCtx)
  if (!ctx) throw new Error('useGrid outside Shell')
  return ctx
}

function Brand() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path d="M6 21c3.3 0 3.3-2 6.7-2s3.3 2 6.6 2 3.4-2 6.7-2" fill="none" stroke="var(--page)" strokeOpacity=".65" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 5v9" stroke="var(--page)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="15.5" r="3.5" fill="var(--accent)" />
    </svg>
  )
}

const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark']

export function Shell() {
  const { t, lang, setLang, locale } = useI18n()
  const { mode, setMode } = useTheme()
  const grid = usePolling(api.grid, 'grid', 60_000)
  const location = useLocation()
  const [, tick] = useState(0)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]
  const ThemeIcon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor
  const open = grid.data?.stats.openAlerts ?? 0

  return (
    <GridCtx.Provider value={grid}>
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <div className="chart-border" aria-hidden="true" />
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Kordura">
            <Brand />
            <span className="brand-word">Kordura</span>
            {/*<span className="brand-site place">Župski zaljev</span>*/}
          </Link>
          <nav className="nav" aria-label="Primary">
            <NavLink to="/" end>
              {t('nav.grid')}
            </NavLink>
            <NavLink to="/alerts">
              {t('nav.alerts')}
              {open > 0 && (
                <span className="count" aria-label={`${open} ${t('grid.kpi.alerts')}`}>
                  {open}
                </span>
              )}
            </NavLink>
          </nav>
          <div className="topbar-tools">
            <span className="live" data-state={grid.error ? 'error' : 'ok'} role="status" aria-live="polite">
              <span className="live-dot" aria-hidden="true" />
              <span className="live-text">
                {grid.error ? t('live.error') : grid.updatedAt ? t('live.updated', { t: fmtTime(locale, grid.updatedAt) }) : t('common.loading')}
              </span>
            </span>
            <span className="sim-tag" title={t('app.simulatedHint')} tabIndex={0}>
              {t('app.simulated')}
            </span>
            <button className="text-btn" onClick={() => setLang(lang === 'en' ? 'hr' : 'en')} lang={lang === 'en' ? 'hr' : 'en'}>
              <IconLang size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              <span className="lang-long">{t('lang.switch')}</span>
              <span className="lang-short" aria-hidden="true">
                {lang === 'en' ? 'HR' : 'EN'}
              </span>
            </button>
            <button
              className="icon-btn"
              onClick={() => setMode(nextTheme)}
              aria-label={`${t('theme.toggle')}: ${t(`theme.${mode}`)} → ${t(`theme.${nextTheme}`)}`}
              title={`${t('theme.toggle')} (${t(`theme.${mode}`)})`}
            >
              <ThemeIcon size={17} />
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer">
        {/*<span>Kordura · Demo</span>*/}
        <span>{t('app.simulatedHint')}</span>
      </footer>
    </GridCtx.Provider>
  )
}
