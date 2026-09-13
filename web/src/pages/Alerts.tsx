import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertCard } from '../components/AlertCard'
import { WATER_QUALITY } from '../components/Badges'
import { useGrid } from '../components/Shell'
import { api, usePolling } from '../lib/api'
import { fmtNum } from '../lib/format'
import { useI18n } from '../lib/i18n'

type StateFilter = 'active' | 'all'
type KindFilter = 'all' | 'wq' | 'tech'

export function AlertsPage() {
  const { t, locale } = useI18n()
  const grid = useGrid()
  const alerts = usePolling(api.alerts, 'alerts', 60_000)
  const [state, setState] = useState<StateFilter>('all')
  const [kind, setKind] = useState<KindFilter>('wq')
  const [node, setNode] = useState('all')
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash || !alerts.data) return
    const el = document.getElementById(decodeURIComponent(hash.slice(1)))
    el?.scrollIntoView({ block: 'center' })
    el?.focus?.()
  }, [hash, alerts.data])

  const nodes = grid.data?.nodes ?? []
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes])
  const list = (alerts.data?.alerts ?? []).filter(
    (a) =>
      (state === 'all' || a.closedAt === null || a.state === 'sampling') &&
      (kind === 'all' || (kind === 'wq' ? WATER_QUALITY.includes(a.kind) : !WATER_QUALITY.includes(a.kind))) &&
      (node === 'all' || a.nodeId === node),
  )
  const ev = alerts.data?.evaluation
  const pct = (v: number | null) => (v === null ? '—' : fmtNum(locale, v * 100, 0))

  return (
    <>
      <div className="section-head" style={{ marginBottom: 20 }}>
        <div>
          <div className="eyebrow rise">{t('grid.eyebrow')}</div>
          <h1 className="place rise" style={{ fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 380, ['--i' as string]: 1 }}>
            {t('alerts.title')}
          </h1>
          <p className="section-hint rise" style={{ fontSize: 15, ['--i' as string]: 2 }}>
            {t('alerts.lede')}
          </p>
        </div>
      </div>

      {ev && (
        <section className="card rise" style={{ ['--i' as string]: 3 }} aria-labelledby="eval-title">
          <div className="panel" style={{ paddingBottom: 0 }}>
            <h2 className="eyebrow" id="eval-title">
              {t('alerts.eval')}
            </h2>
          </div>
          <div className="eval-grid">
            <div className="eval">
              <span className="kpi-label">{t('alerts.eval.precision')}</span>
              <span className="eval-value">
                {pct(ev.precision)}
                <small>%</small>
              </span>
              <span className="eval-hint">{t('alerts.eval.precisionHint', { c: ev.confirmed, e: ev.evaluated })}</span>
            </div>
            <div className="eval">
              <span className="kpi-label">{t('alerts.eval.recall')}</span>
              <span className="eval-value">
                {pct(ev.recall)}
                <small>%</small>
              </span>
              <span className="eval-hint">{t('alerts.eval.recallHint', { m: ev.missed })}</span>
            </div>
            <div className="eval">
              <span className="kpi-label">{t('alerts.eval.lead')}</span>
              <span className="eval-value">
                {ev.medianLeadTimeH === null ? '—' : fmtNum(locale, ev.medianLeadTimeH, 0)}
                <small>h</small>
              </span>
              <span className="eval-hint">{t('alerts.eval.leadHint')}</span>
            </div>
            <div className="eval">
              <span className="kpi-label">{t('alerts.eval.unseen')}</span>
              <span className="eval-value">{ev.unseenByRoutine}</span>
              <span className="eval-hint">{t('alerts.eval.unseenHint')}</span>
            </div>
            <div className="eval">
              <span className="kpi-label">{t('alerts.eval.suppressed')}</span>
              <span className="eval-value">{ev.suppressed.freshwater + ev.suppressed.upwelling}</span>
              <span className="eval-hint">{t('alerts.eval.suppressedHint', { f: ev.suppressed.freshwater, u: ev.suppressed.upwelling })}</span>
            </div>
          </div>
        </section>
      )}

      <div className="toolbar" style={{ margin: '28px 0 14px' }}>
        <div className="seg" role="group" aria-label="State">
          {(['active', 'all'] as const).map((s) => (
            <button key={s} aria-pressed={state === s} onClick={() => setState(s)}>
              {t(`alerts.filter.${s}`)}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Kind">
          {(['wq', 'tech', 'all'] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(k === 'all' ? 'common.all' : `alerts.filter.${k}`)}
            </button>
          ))}
        </div>
        <label className="toolbar-group">
          <span className="toolbar-label">{t('alerts.filter.node')}</span>
          <select className="input" value={node} onChange={(e) => setNode(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} · {n.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }} aria-live="polite">
          {list.length}
        </span>
      </div>

      {alerts.error && !alerts.data && (
        <div className="error-banner" role="alert">
          {t('live.error')}
          <button className="btn" data-size="sm" onClick={alerts.reload}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="alert-list dim" data-loading={alerts.loading && !!alerts.data}>
        {!alerts.data && !alerts.error && <div className="empty">{t('common.loading')}</div>}
        {alerts.data && list.length === 0 && <div className="card empty">{t('alerts.empty')}</div>}
        {list.map((a) => (
          <AlertCard key={a.id} alert={a} node={byId[a.nodeId]} />
        ))}
      </div>
    </>
  )
}
