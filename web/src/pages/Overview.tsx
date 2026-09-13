import { PARAM_META, type Alert, type GridResponse, type Param } from '@shared/types'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AssessmentBadge, RiskIcon, riskTone, WATER_QUALITY } from '../components/Badges'
import { EChart } from '../components/charts/EChart'
import { compareOption, NODE_COLOR_INDEX } from '../components/charts/options'
import { DataTable } from '../components/DataTable'
import { GridMap } from '../components/GridMap'
import { IconArrow, IconDrop, IconThermo, IconWaves, IconBolt } from '../components/Icons'
import { NodeCard } from '../components/NodeCard'
import { RangePicker, rangeKey, resolveRange, type RangeValue } from '../components/RangePicker'
import { useGrid } from '../components/Shell'
import { api, usePolling } from '../lib/api'
import { fmtAgo, fmtDateTime, fmtIn, fmtNum, fmtParam, unitOf } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'

const COMPARE_PARAMS: Param[] = ['salinity', 'temp', 'turbidity', 'do_sat', 'orp', 'ph']
const COMPARE_HEIGHT = 330

function Contours() {
  // Stylised bathymetric isolines behind the title.
  const paths = Array.from({ length: 9 }, (_, i) => {
    const r = 40 + i * 26
    return `M ${-40} ${150 + i * 18} C ${120 + i * 8} ${40 - r * 0.2}, ${330 + i * 12} ${260 + r * 0.25}, ${720} ${110 + i * 22}`
  })
  return (
    <svg className="contours" viewBox="0 0 700 420" preserveAspectRatio="none" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={i % 4 === 0 ? 1.6 : 1} />
      ))}
    </svg>
  )
}

function Hero({ grid }: { grid: GridResponse }) {
  const { t, locale } = useI18n()
  const attention = grid.nodes.filter((n) => n.status !== 'online' || n.risk.level !== 'normal')
  const s = grid.stats
  const o = grid.officialSampling
  return (
    <section className="hero">
      <div className="hero-copy">
        <Contours />
        <div className="eyebrow rise">{t('grid.eyebrow')}</div>
        <h1 className="hero-title rise" style={{ ['--i' as string]: 1 }}>
          {grid.site.name}
          <span className="coord">
            {grid.site.municipality} · {grid.site.county}
          </span>
        </h1>
        <p className="hero-lede rise" style={{ ['--i' as string]: 2 }}>
          {t('grid.lede', { n: grid.nodes.length })}
        </p>
        <div className="hero-status rise" style={{ ['--i' as string]: 3 }}>
          {attention.length === 0 ? (
            <span className="badge" data-tone="good">
              <RiskIcon level="normal" />
              {t('grid.summaryCalm')}
            </span>
          ) : (
            <>
              <span className="ink2" style={{ fontSize: 14 }}>
                {t(attention.length === 1 ? 'grid.summaryAttention' : 'grid.summaryAttentionPlural', { n: attention.length })}:
              </span>
              {attention.map((n) => (
                <Link key={n.id} to={`/nodes/${n.id}`} className="badge" data-tone={n.risk.level !== 'normal' ? riskTone(n.risk.level) : 'warning'} style={{ textDecoration: 'none' }}>
                  <RiskIcon level={n.risk.level !== 'normal' ? n.risk.level : 'watch'} />
                  {n.name} · {n.risk.signature ? t(`sig.${n.risk.signature}`) : t(`status.${n.status}`)}
                </Link>
              ))}
            </>
          )}
        </div>

        <div className="kpis rise" style={{ ['--i' as string]: 4 }}>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.samples')}</span>
            <span className="kpi-value">
              {s.samples24h}
              <small>/ {s.expected24h}</small>
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.valid')}</span>
            <span className="kpi-value">
              {fmtNum(locale, s.validPct24h, 1)}
              <small>%</small>
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.alerts')}</span>
            <span className="kpi-value">
              <Link to="/alerts" style={{ color: 'inherit' }}>
                {s.openAlerts}
              </Link>
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.labPairs')}</span>
            <span className="kpi-value">
              {s.labPairs}
              <small>/ 80</small>
            </span>
            <div className="kpi-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (s.labPairs / 80) * 100)}%` }} />
            </div>
          </div>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.orientation')}</span>
            <span className="kpi-value">
              {s.orientationAnalyses}
              <small>/ 400</small>
            </span>
            <div className="kpi-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (s.orientationAnalyses / 400) * 100)}%` }} />
            </div>
          </div>
          <div className="kpi">
            <span className="kpi-label">{t('grid.kpi.official')}</span>
            <span className="kpi-value" style={{ fontSize: 15, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
              {o.lastAt ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t('grid.kpi.officialLast', { ago: fmtAgo(t, o.lastAt) })}
                  <AssessmentBadge assessment={o.lastAssessment} />
                </span>
              ) : (
                '—'
              )}
            </span>
            {o.nextDueAt && <span className="kpi-sub">{t('grid.kpi.officialNext', { in: fmtIn(t, o.nextDueAt) })}</span>}
          </div>
        </div>
      </div>
      <GridMap grid={grid} />
    </section>
  )
}

function Compare({ grid }: { grid: GridResponse }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const [param, setParam] = useState<Param>('salinity')
  const [range, setRange] = useState<RangeValue>({ preset: '7d' })
  const [table, setTable] = useState(false)
  const key = `${param}|${rangeKey(range)}`
  const data = usePolling(
    async () => {
      const { from, to } = resolveRange(range, Date.now())
      const [c, e] = await Promise.all([api.compare(param, from, to), api.environment(from, to)])
      return { c, e }
    },
    key,
    120_000,
  )
  const names = useMemo(() => Object.fromEntries(grid.nodes.map((n) => [n.id, n.name])), [grid.nodes])
  const option = useMemo(() => (data.data ? compareOption({ tk: tokens, t, locale }, data.data.c, data.data.e, names, COMPARE_HEIGHT) : null), [data.data, tokens, t, locale, names])

  return (
    <section className="section" aria-labelledby="compare-title">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="compare-title">
            {t('grid.compare')}
          </h2>
          <p className="section-hint">{t('grid.compareHint')}</p>
        </div>
      </div>
      <div className="card chart-card">
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <div className="seg" role="group" aria-label={t('node.params')}>
            {COMPARE_PARAMS.map((p) => (
              <button key={p} aria-pressed={param === p} onClick={() => setParam(p)}>
                {t(`param.${p}`)}
              </button>
            ))}
          </div>
          <RangePicker value={range} onChange={setRange} presets={['24h', '7d', '30d']} />
          <button className="chip" aria-pressed={table} onClick={() => setTable((v) => !v)} style={{ marginLeft: 'auto' }}>
            <span className="check" />
            {t('common.showTable')}
          </button>
        </div>
        <div className="legend">
          {grid.nodes.map((n) => (
            <span className="legend-item" key={n.id}>
              <span className="legend-line" style={{ ['--c' as string]: tokens.series[NODE_COLOR_INDEX[n.id] ?? 0] }} />
              <span className="mono" style={{ fontSize: 11 }}>
                {n.id}
              </span>
              {n.name}
            </span>
          ))}
          <span className="legend-item muted">
            <span className="legend-rect" style={{ ['--c' as string]: tokens.muted }} />
            {t('node.env.rain')}
          </span>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            {unitOf(param)}
          </span>
        </div>
        <div className="dim" data-loading={data.loading && !!data.data}>
          {table && data.data ? (
            <DataTable
              caption={t('grid.compare')}
              rows={data.data.c.t.map((x, i) => ({ x, i }))}
              rowKey={(r) => String(r.x)}
              columns={[
                { key: 't', header: t('common.time'), render: (r) => <span className="mono">{fmtDateTime(locale, r.x)}</span> },
                ...grid.nodes.map((n) => ({
                  key: n.id,
                  header: `${n.name} (${PARAM_META[param].unit})`,
                  num: true,
                  render: (r: { i: number }) => fmtParam(locale, param, data.data!.c.series[n.id]?.[r.i] ?? null),
                })),
              ]}
            />
          ) : option ? (
            <EChart option={option} height={COMPARE_HEIGHT} label={`${t('grid.compare')}: ${t(`param.${param}`)}`} zoomKey={key} />
          ) : (
            <div style={{ height: COMPARE_HEIGHT }} className="empty">
              {t('common.loading')}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Conditions({ grid }: { grid: GridResponse }) {
  const { t, locale } = useI18n()
  const e = grid.env
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2 className="panel-title">{t('grid.conditions')}</h2>
      </div>
      <div className="conditions">
        <div className="condition">
          <div className="condition-label">{t('grid.conditions.wind')}</div>
          <div className="condition-value">
            {/* Arrow points where the wind blows to. */}
            <IconArrow size={18} deg={e.windDir + 180} aria-hidden />
            {fmtNum(locale, e.windMs, 1)}
            <small>m/s · {t(`wind.${e.windName}`)}</small>
          </div>
        </div>
        <div className="condition">
          <div className="condition-label">{t('grid.conditions.rain')}</div>
          <div className="condition-value">
            <IconDrop size={17} />
            {fmtNum(locale, e.rain24h, 1)}
            <small>mm</small>
          </div>
        </div>
        <div className="condition">
          <div className="condition-label">{t('grid.conditions.tide')}</div>
          <div className="condition-value">
            <IconWaves size={17} />
            {fmtNum(locale, e.tideM, 2, true)}
            <small>m · {t(`grid.conditions.${e.tideTrend}`)}</small>
          </div>
        </div>
        <div className="condition">
          <div className="condition-label">{t('grid.conditions.air')}</div>
          <div className="condition-value">
            <IconThermo size={17} />
            {fmtNum(locale, e.airTemp, 1)}
            <small>°C</small>
          </div>
        </div>
        <div className="condition" style={{ gridColumn: '1 / -1', borderBottom: 0 }}>
          <div className="condition-label">{t('grid.conditions.hpp')}</div>
          <div className="condition-value" style={{ fontSize: 16 }}>
            <IconBolt size={16} />
            {e.hppActive ? t('grid.conditions.hppOn') : t('grid.conditions.hppOff')}
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {t('grid.conditions.source')}
      </p>
    </div>
  )
}

export function alertTitle(t: ReturnType<typeof useI18n>['t'], a: Alert) {
  return t(`sig.${a.kind}`)
}

function RecentAlerts({ grid }: { grid: GridResponse }) {
  const { t, locale } = useI18n()
  const alerts = usePolling(api.alerts, 'alerts-mini', 60_000)
  const names = Object.fromEntries(grid.nodes.map((n) => [n.id, n.name]))
  const list = (alerts.data?.alerts ?? []).filter((a) => WATER_QUALITY.includes(a.kind) || a.closedAt === null).slice(0, 5)
  return (
    <div className="card panel">
      <div className="panel-head">
        <h2 className="panel-title">{t('grid.recentAlerts')}</h2>
        <Link to="/alerts" style={{ fontSize: 13 }}>
          {t('grid.allAlerts')} →
        </Link>
      </div>
      {list.length === 0 && <p className="muted">{alerts.loading ? t('common.loading') : t('common.none')}</p>}
      {list.map((a) => (
        <Link key={a.id} to={`/alerts#${a.id}`} className="alert-mini">
          <span style={{ paddingTop: 2, color: a.closedAt ? 'var(--muted)' : `var(--status-${riskTone(a.severity)}-ink)` }}>
            <RiskIcon level={a.severity} size={16} />
          </span>
          <span className="alert-mini-title">
            {alertTitle(t, a)} · <span className="place">{names[a.nodeId]}</span>
          </span>
          <span className="alert-mini-meta">
            {fmtDateTime(locale, a.openedAt)} · {t(`alerts.state.${a.state}`)}
            {a.verdict?.ecoli != null && ` · E. coli ${a.verdict.ecoli}`}
          </span>
        </Link>
      ))}
    </div>
  )
}

export function Overview() {
  const { t } = useI18n()
  const grid = useGrid()

  if (!grid.data) {
    return grid.error ? (
      <div className="error-banner" role="alert">
        {t('live.error')}
        <button className="btn" data-size="sm" onClick={grid.reload}>
          {t('common.retry')}
        </button>
      </div>
    ) : (
      <div className="empty">{t('common.loading')}</div>
    )
  }
  const g = grid.data

  return (
    <>
      {grid.error && (
        <div className="error-banner" role="alert">
          {t('live.error')}
        </div>
      )}
      <Hero grid={g} />

      <section className="section" aria-labelledby="nodes-title">
        <div className="section-head">
          <h2 className="section-title" id="nodes-title">
            {t('grid.nodes')}
          </h2>
        </div>
        <div className="nodes-grid">
          {g.nodes.map((n, i) => (
            <NodeCard key={n.id} node={n} index={i} />
          ))}
        </div>
      </section>

      <Compare grid={g} />

      <section className="section two-col">
        <RecentAlerts grid={g} />
        <Conditions grid={g} />
      </section>
    </>
  )
}
