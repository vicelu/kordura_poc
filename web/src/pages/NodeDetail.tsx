import { PARAM_META, type LabSample, type NodeSummary, type Param, type SeriesResponse } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertCard } from '../components/AlertCard'
import { AssessmentBadge, RiskBadge, StatusBadge } from '../components/Badges'
import { EChart } from '../components/charts/EChart'
import { ENV_HEIGHT, envOption, healthOption, NODE_COLOR_INDEX, paramOption, regimeColor, riskOption, tsOption, type Overlays } from '../components/charts/options'
import { DataTable } from '../components/DataTable'
import { IconDownload, IconInfo } from '../components/Icons'
import { parseRange, RangePicker, rangeKey, resolveRange, type RangeValue } from '../components/RangePicker'
import { useGrid } from '../components/Shell'
import { api, isDemo, usePolling } from '../lib/api'
import { fmtAgo, fmtDateTime, fmtDay, fmtNum, fmtParam, unitOf } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'

const D = 86_400_000
const ALL_PARAMS: Param[] = ['temp', 'salinity', 'conductivity', 'ph', 'do_sat', 'do_mgl', 'turbidity', 'orp']
const DEFAULT_PARAMS: Param[] = ['temp', 'salinity', 'ph', 'do_sat', 'turbidity', 'orp']

function useStoredState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...initial, ...JSON.parse(raw) } : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* storage unavailable */
    }
  }, [key, v])
  return [v, setV] as const
}

// ------------------------------------------------------------------ header + layers

function Header({ node, exportHref }: { node: NodeSummary; exportHref: string }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const color = tokens.series[NODE_COLOR_INDEX[node.id] ?? 0]
  return (
    <div>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">{t('node.breadcrumb')}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{node.name}</span>
      </nav>
      <div className="node-head">
        <div>
          <div className="node-title">
            <h1 className="place rise">{node.name}</h1>
            <span className="id rise" style={{ ['--i' as string]: 1 }}>
              <span className="swatch" style={{ ['--c' as string]: color }} />
              {node.id}
            </span>
            <span className="rise" style={{ ['--i' as string]: 1, display: 'inline-flex', gap: 6 }}>
              <StatusBadge status={node.status} />
            </span>
          </div>
          <dl className="node-meta rise" style={{ ['--i' as string]: 2 }}>
            <div>
              <dt>{node.place}</dt>
              <dd className="mono" style={{ fontSize: 12 }}>
                {node.lat.toFixed(4)}°N {node.lon.toFixed(4)}°E
              </dd>
            </div>
            <div>
              <dt>{t('node.depth')}</dt>
              <dd>{fmtNum(locale, node.depthM, 1)} m</dd>
            </div>
            <div>
              <dt>{t('node.deployed')}</dt>
              <dd>{fmtDay(locale, node.deployedAt)}</dd>
            </div>
            <div>
              <dt>{t('node.hardware')}</dt>
              <dd>{node.health.hardware}</dd>
            </div>
            <div>
              <dt>{t('node.firmware')}</dt>
              <dd className="mono" style={{ fontSize: 12 }}>
                {node.health.firmware}
              </dd>
            </div>
            <div>
              {node.nearField.map((n) => (
                <span className="tag" key={n} style={{ marginRight: 6 }}>
                  {t(`near.${n}`)}
                </span>
              ))}
            </div>
          </dl>
        </div>
        <div className="node-actions">
          <a
            className="btn"
            href={exportHref}
            download
            onClick={
              isDemo
                ? (e) => {
                    e.preventDefault()
                    void api.demoDownload(exportHref)
                  }
                : undefined
            }
          >
            <IconDownload size={15} />
            {t('node.export')}
          </a>
        </div>
      </div>
    </div>
  )
}

function Layers({ node, lab }: { node: NodeSummary; lab: LabSample[] | null }) {
  const { t, locale } = useI18n()
  const r = node.risk
  const reference = (lab ?? []).filter((l) => l.source !== 'orientation')
  const pending = reference.find((l) => l.assessment === null)
  const last = reference.find((l) => l.assessment !== null)
  return (
    <section className="card layers rise" style={{ ['--i' as string]: 3 }} aria-label={t('node.layers.title')}>
      <div className="layer">
        <div className="layer-step">
          <span className="layer-num">1</span>
          <span className="eyebrow">{t('node.layers.deviation')}</span>
        </div>
        {r.drivers.length ? (
          <div className="drivers">
            {r.drivers.map((d) => (
              <span className="driver" key={d.param}>
                {d.param === 'rain' ? t('param.rain') : t(`param.${d.param}`)}
                <span className="mono">
                  {d.param === 'rain' ? '' : `${fmtParam(locale, d.param, d.delta, true)} ${unitOf(d.param)}`} · z {fmtNum(locale, d.z, 1, true)}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="layer-sub">{t('node.layers.deviationNone')}</p>
        )}
      </div>
      <div className="layer">
        <div className="layer-step">
          <span className="layer-num">2</span>
          <span className="eyebrow">{t('node.layers.risk')}</span>
        </div>
        <div className="layer-main">
          <RiskBadge level={r.level} score={r.score} />
          <span>{r.signature ? t(`sig.${r.signature}`) : t('sig.none')}</span>
        </div>
        <div className="score-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.score} aria-label={t('node.risk')}>
          <span style={{ left: `${Math.min(100, Math.max(0, r.score))}%` }} />
        </div>
        <p className="layer-sub">{t('node.layers.riskModel')}</p>
      </div>
      <div className="layer">
        <div className="layer-step">
          <span className="layer-num">3</span>
          <span className="eyebrow">{t('node.layers.lab')}</span>
        </div>
        {last ? (
          <>
            <div className="layer-main">
              <AssessmentBadge assessment={last.assessment} />
              <span className="mono" style={{ fontSize: 13, fontWeight: 450 }}>
                E. coli {last.ecoli} · IE {last.enterococci}
              </span>
            </div>
            <p className="layer-sub">
              {t('node.layers.labLast', { ago: fmtAgo(t, last.resultAt) })} · {t(`lab.src.${last.source}`)}
            </p>
          </>
        ) : (
          <p className="layer-sub">{t('node.layers.labNone')}</p>
        )}
        {pending && (
          <p className="layer-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <AssessmentBadge assessment={null} />
            {t('node.layers.labPending', { ago: fmtAgo(t, pending.t) })}
          </p>
        )}
      </div>
      <p className="disclaimer">
        <IconInfo size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        {t('node.layers.disclaimer')}
      </p>
    </section>
  )
}

function Tiles({ node, series }: { node: NodeSummary; series: SeriesResponse | null }) {
  const { t, locale } = useI18n()
  return (
    <section className="section" aria-labelledby="current-title" style={{ marginTop: 28 }}>
      <div className="section-head">
        <h2 className="section-title" id="current-title">
          {t('node.current')}
        </h2>
        {node.latest && <span className="muted mono" style={{ fontSize: 12 }}>{fmtDateTime(locale, node.latest.t)} · {fmtAgo(t, node.latest.t)}</span>}
      </div>
      <div className="tiles">
        {ALL_PARAMS.map((p, i) => {
          const v = node.latest?.values[p] ?? null
          const b = series?.baseline[p]
          let pos = 50
          let lo = 0
          let hi = 100
          let state: 'in' | 'above' | 'below' = 'in'
          if (b && v !== null) {
            const spread = Math.max(b.p90 - b.p10, Math.abs(b.p50) * 0.002, 1e-6)
            const min = Math.min(b.p10 - spread * 0.6, v)
            const max = Math.max(b.p90 + spread * 0.6, v)
            const sc = (x: number) => ((x - min) / (max - min)) * 100
            pos = sc(v)
            lo = sc(b.p10)
            hi = sc(b.p90)
            state = v > b.p90 ? 'above' : v < b.p10 ? 'below' : 'in'
          }
          return (
            <div className="card tile rise" key={p} data-out={state !== 'in'} style={{ ['--i' as string]: 4 + i * 0.5 }}>
              <span className="tile-label">
                {t(`param.${p}`)}
                {p === 'do_sat' || p === 'do_mgl' ? ` (${unitOf(p)})` : ''}
              </span>
              <span className="tile-value">
                {fmtParam(locale, p, v)}
                <small>{unitOf(p)}</small>
              </span>
              <div className="band-meter" aria-hidden="true">
                <span className="band" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
                <span className="pin" style={{ left: `${pos}%` }} />
              </div>
              <span className="tile-foot">
                <span style={{ color: state !== 'in' ? 'var(--status-critical-ink)' : undefined }}>{t(state === 'in' ? 'node.inBand' : state === 'above' ? 'node.aboveBand' : 'node.belowBand')}</span>
                <span className="mono" title={t('card.delta')}>
                  {fmtParam(locale, p, node.delta24h[p], true)} / 24 h
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ charts

function ChartLegend({ series }: { series: SeriesResponse }) {
  const { t } = useI18n()
  const { tokens } = useTheme()
  const minMs = series.resolution === 'raw' ? 0 : 6 * 3_600_000
  const kinds = [...new Set(series.regimes.filter((r) => r.to - r.from >= minMs).map((r) => r.regime))]
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="legend-line" style={{ ['--c' as string]: tokens.line }} />
        {series.resolution === 'raw' ? t('node.resolution.raw') : t('node.resolution.agg', { r: series.resolution })}
      </span>
      <span className="legend-item">
        <span className="legend-rect" style={{ ['--c' as string]: tokens.band, ['--b' as string]: tokens.axis }} />
        {t('node.baselineBand')}
      </span>
      {kinds.map((k) => (
        <span className="legend-item" key={k}>
          <span className="legend-rect" style={{ ['--c' as string]: regimeColor(tokens, k, true), ['--b' as string]: regimeColor(tokens, k) }} />
          {t(`regime.${k}`)}
        </span>
      ))}
      {series.maintenance.some((m) => m.t >= series.from) && (
        <span className="legend-item">
          <span style={{ width: 1, height: 12, background: tokens.ink2, display: 'inline-block' }} />
          {t('node.overlay.maintenance')}
        </span>
      )}
    </div>
  )
}

function ParamPanel({ series, p, ov, table, group, zoomKey }: { series: SeriesResponse; p: Param; ov: Overlays; table: boolean; group: string; zoomKey: string }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const option = useMemo(() => paramOption({ tk: tokens, t, locale }, series, p, ov), [series, p, ov, tokens, t, locale])
  const latest = series.node.latest?.values[p] ?? null
  const b = series.baseline[p]
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3 className="chart-title">
          {t(`param.${p}`)} <span className="unit">{unitOf(p)}</span>
        </h3>
        <div className="chart-now">
          <span>
            <b>{fmtParam(locale, p, latest)}</b> <span className="muted">{unitOf(p)}</span>
          </span>
          <span className="muted mono" style={{ fontSize: 11.5 }}>
            P10–P90 {fmtParam(locale, p, b.p10)}–{fmtParam(locale, p, b.p90)}
          </span>
        </div>
      </div>
      {table ? (
        <div style={{ padding: '8px 0 10px' }}>
          <DataTable
            caption={t(`param.${p}`)}
            rows={series.t.map((x, i) => ({ x, i })).reverse()}
            rowKey={(r) => String(r.x)}
            columns={[
              { key: 't', header: t('common.time'), render: (r) => <span className="mono">{fmtDateTime(locale, r.x)}</span> },
              { key: 'v', header: `${t('common.value')} (${PARAM_META[p].unit})`, num: true, render: (r) => fmtParam(locale, p, series.values[p][r.i]) },
              ...(series.resolution !== 'raw'
                ? [
                    { key: 'min', header: 'min', num: true, render: (r: { i: number }) => fmtParam(locale, p, series.min[p]?.[r.i] ?? null) },
                    { key: 'max', header: 'max', num: true, render: (r: { i: number }) => fmtParam(locale, p, series.max[p]?.[r.i] ?? null) },
                  ]
                : []),
            ]}
          />
        </div>
      ) : (
        <EChart option={option} height={168} group={group} zoomKey={zoomKey} label={`${t(`param.${p}`)} (${unitOf(p)})`} />
      )}
    </div>
  )
}

function RiskPanel({ series, group, zoomKey }: { series: SeriesResponse; group: string; zoomKey: string }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const option = useMemo(() => riskOption({ tk: tokens, t, locale }, series), [series, tokens, t, locale])
  const s = tokens.status
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h3 className="chart-title">{t('node.risk')}</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {t('node.riskHint')}
        </span>
      </div>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-rect" style={{ ['--c' as string]: `${s.serious}2e` }} />
          {t('node.alertPeriod')}
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ ['--c' as string]: s.good }} />
          {t('assess.excellent')} / {t('assess.good')}
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ ['--c' as string]: s.warning }} />
          {t('assess.sufficient')}
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ ['--c' as string]: s.critical }} />
          {t('assess.poor')}
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ ['--c' as string]: 'transparent', border: `1.5px solid ${tokens.ink2}` }} />
          {t('common.pending')}
        </span>
        <span className="legend-item muted">■ {t('lab.src.official')} · ● {t('lab.src.reference')} · ◆ {t('lab.src.orientation')}</span>
      </div>
      <EChart option={option} height={210} group={group} zoomKey={zoomKey} label={t('node.risk')} />
    </div>
  )
}

// ------------------------------------------------------------------ lab table

function LabPanel({ lab }: { lab: LabSample[] }) {
  const { t, locale } = useI18n()
  const [src, setSrc] = useState<'all' | LabSample['source']>('all')
  const rows = lab.filter((l) => src === 'all' || l.source === src)
  return (
    <section className="section" aria-labelledby="lab-title">
      <div className="section-head">
        <div>
          <h2 className="section-title" id="lab-title">
            {t('node.lab')}
          </h2>
          <p className="section-hint">{t('node.labHint')}</p>
        </div>
        <div className="seg" role="group" aria-label={t('lab.filter')}>
          {(['all', 'reference', 'orientation', 'official'] as const).map((s) => (
            <button key={s} aria-pressed={src === s} onClick={() => setSrc(s)}>
              {s === 'all' ? t('common.all') : t(`lab.src.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <DataTable
        caption={t('node.lab')}
        rows={rows}
        pageSize={10}
        rowKey={(l) => l.id}
        columns={[
          { key: 't', header: t('lab.sampled'), render: (l) => <span className="mono" style={{ fontSize: 12.5 }}>{fmtDateTime(locale, l.t)}</span> },
          { key: 'src', header: t('lab.source'), render: (l) => t(`lab.src.${l.source}`) },
          { key: 'trg', header: t('lab.trigger'), render: (l) => (l.trigger === 'sensor_alert' ? <strong>{t('lab.trg.sensor_alert')}</strong> : t(`lab.trg.${l.trigger}`)) },
          { key: 'ec', header: `${t('lab.ecoli')}`, num: true, render: (l) => (l.ecoli === null ? '—' : l.ecoli) },
          { key: 'ie', header: `${t('lab.ent')}`, num: true, render: (l) => (l.enterococci === null ? '—' : l.enterococci) },
          { key: 'as', header: t('lab.assessment'), render: (l) => <AssessmentBadge assessment={l.assessment} /> },
          {
            key: 'sensor',
            header: t('lab.sensorAt'),
            render: (l) =>
              l.sensor ? (
                <span className="mono muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  {fmtParam(locale, 'temp', l.sensor.temp)}°C · S {fmtParam(locale, 'salinity', l.sensor.salinity)} · {fmtParam(locale, 'turbidity', l.sensor.turbidity)} NTU · O₂ {fmtParam(locale, 'do_sat', l.sensor.do_sat)}%
                </span>
              ) : (
                <span className="muted">—</span>
              ),
          },
        ]}
      />
    </section>
  )
}

// ------------------------------------------------------------------ page

export function NodeDetail() {
  const { id = '' } = useParams()
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const grid = useGrid()
  const [search, setSearch] = useSearchParams()
  const range = parseRange(search)
  const rk = rangeKey(range)
  const [ov, setOv] = useStoredState<Overlays>('kordura.overlays', { regimes: true, baseline: true, maintenance: true, qc: true })
  const [params, setParams] = useStoredState<{ list: Param[] }>('kordura.params', { list: DEFAULT_PARAMS })
  const [table, setTable] = useState(false)
  const group = `node-${id}`

  const setRange = (r: RangeValue) => {
    const next = new URLSearchParams()
    if ('preset' in r) next.set('range', r.preset)
    else {
      next.set('from', String(r.from))
      next.set('to', String(r.to))
    }
    setSearch(next, { replace: true })
  }

  const series = usePolling(() => {
    const { from, to } = resolveRange(range, Date.now())
    return api.series(id, from, to)
  }, `${id}|${rk}`, 60_000)
  const env = usePolling(() => {
    const { from, to } = resolveRange(range, Date.now())
    return api.environment(from, to)
  }, `env|${rk}`, 120_000)
  const tsDays = Math.min(90, Math.max(3, Math.round((() => { const r = resolveRange(range, Date.now()); return (r.to - r.from) / D })())))
  const ts = usePolling(() => api.ts(id, tsDays), `${id}|ts|${tsDays}`, 300_000)
  const lab = usePolling(() => api.lab(id), `${id}|lab`, 60_000)
  const alerts = usePolling(api.alerts, 'alerts', 60_000)

  const node = series.data?.node ?? grid.data?.nodes.find((n) => n.id === id) ?? null
  const ctx = { tk: tokens, t, locale }
  const envOpt = useMemo(() => (env.data ? envOption(ctx, env.data, env.data.from, env.data.to) : null), [env.data, tokens, t, locale])
  const tsOpt = useMemo(() => (ts.data && ts.data.points.length ? tsOption(ctx, ts.data) : null), [ts.data, tokens, t, locale])
  const healthOpt = useMemo(() => (series.data ? healthOption(ctx, series.data) : null), [series.data, tokens, t, locale])

  if (series.error && !series.data) {
    return (
      <div className="empty">
        <p>{series.error.message.includes('Unknown node') ? t('node.notFound', { id }) : t('live.error')}</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/">{t('notFound.back')}</Link>
        </p>
      </div>
    )
  }
  if (!node) return <div className="empty">{t('common.loading')}</div>

  const { from, to } = resolveRange(range, Date.now())
  const exportHref = api.exportUrl(id, from, to, ALL_PARAMS)
  const nodeAlerts = (alerts.data?.alerts ?? []).filter((a) => a.nodeId === id)
  const toggleParam = (p: Param) => setParams((s) => ({ list: s.list.includes(p) ? s.list.filter((x) => x !== p) : ALL_PARAMS.filter((x) => x === p || s.list.includes(x)) }))
  const cleaningDue = node.daysSinceCleaning >= 14

  return (
    <>
      <Header node={node} exportHref={exportHref} />
      <Layers node={node} lab={lab.data} />
      <Tiles node={node} series={series.data} />

      <div className="sticky-tools">
        <div className="toolbar" style={{ maxWidth: 'var(--max)', margin: '0 auto' }}>
          <RangePicker key={rk} value={range} onChange={setRange} />
          <div className="toolbar-group" role="group" aria-label={t('node.overlays')}>
            <span className="toolbar-label">{t('node.overlays')}</span>
            {(['regimes', 'baseline', 'maintenance', 'qc'] as const).map((k) => (
              <button key={k} className="chip" aria-pressed={ov[k]} onClick={() => setOv({ ...ov, [k]: !ov[k] })}>
                <span className="check" />
                {t(`node.overlay.${k}`)}
              </button>
            ))}
          </div>
          <button className="chip" aria-pressed={table} onClick={() => setTable((v) => !v)} style={{ marginLeft: 'auto' }}>
            <span className="check" />
            {t('common.showTable')}
          </button>
        </div>
      </div>

      <section className="section" aria-labelledby="series-title" style={{ marginTop: 20 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title" id="series-title">
              {t('node.series')}
            </h2>
            <p className="section-hint">{t('node.seriesHint')}</p>
          </div>
          <div className="toolbar-group" role="group" aria-label={t('node.params')}>
            {ALL_PARAMS.map((p) => (
              <button key={p} className="chip" aria-pressed={params.list.includes(p)} onClick={() => toggleParam(p)}>
                <span className="check" />
                {t(`paramShort.${p}`)}
                {p === 'do_mgl' ? ' mg/L' : p === 'do_sat' ? ' %' : ''}
              </button>
            ))}
          </div>
        </div>
        {series.data ? (
          <div className="stack dim" data-loading={series.loading}>
            <ChartLegend series={series.data} />
            <RiskPanel series={series.data} group={group} zoomKey={rk} />
            {params.list.map((p) => (
              <ParamPanel key={p} series={series.data!} p={p} ov={ov} table={table} group={group} zoomKey={rk} />
            ))}
          </div>
        ) : (
          <div className="empty">{t('common.loading')}</div>
        )}
      </section>

      <section className="section" aria-labelledby="env-title">
        <div className="section-head">
          <h2 className="section-title" id="env-title">
            {t('node.env')}
          </h2>
        </div>
        <div className="card chart-card dim" data-loading={env.loading}>
          {envOpt ? <EChart option={envOpt} height={ENV_HEIGHT} zoomKey={rk} label={t('node.env')} /> : <div className="empty">{t('common.loading')}</div>}
        </div>
      </section>

      <section className="section grid-2">
        <div className="card panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('node.ts')}</h2>
            <span className="muted mono" style={{ fontSize: 11.5 }}>
              {tsDays} d
            </span>
          </div>
          <p className="section-hint" style={{ marginBottom: 6 }}>
            {t('node.tsHint')}
          </p>
          {ts.data && (
            <div className="legend">
              {(['marine', 'freshwater', 'runoff', 'upwelling'] as const)
                .filter((r) => ts.data!.counts[r] > 0)
                .map((r) => (
                  <span className="legend-item" key={r}>
                    <span className="legend-dot" style={{ ['--c' as string]: regimeColor(tokens, r) }} />
                    {t(`regime.${r}`)} <span className="muted mono" style={{ fontSize: 11 }}>{ts.data!.counts[r]}</span>
                  </span>
                ))}
              <span className="legend-item">
                <span className="legend-dot" style={{ ['--c' as string]: 'transparent', border: `2px solid ${tokens.ink}` }} />
                {t('node.tsLatest')}
              </span>
            </div>
          )}
          {tsOpt ? <EChart option={tsOpt} height={340} label={t('node.ts')} /> : <div className="empty">{t('common.loading')}</div>}
        </div>

        <div className="card panel">
          <div className="panel-head">
            <h2 className="panel-title">{t('node.health')}</h2>
          </div>
          <div className="stat-list">
            <div className="stat-row">
              <span>{t('node.health.battery')}</span>
              <b>
                {fmtNum(locale, node.health.batteryPct, 0)}% · {fmtNum(locale, node.health.batteryV, 2)} V
              </b>
            </div>
            <div className="stat-row">
              <span>{t('node.health.solar')}</span>
              <b>{fmtNum(locale, node.health.solarW, 1)} W</b>
            </div>
            <div className="stat-row">
              <span>
                {t('node.health.rssi')} / {t('node.health.snr')}
              </span>
              <b>
                {node.health.rssi} dBm · {fmtNum(locale, node.health.snr, 1)} dB
              </b>
            </div>
            <div className="stat-row">
              <span>{t('node.health.pdr')}</span>
              <b>{fmtNum(locale, node.health.pdr24h * 100, 1)}%</b>
            </div>
            <div className="stat-row">
              <span>{t('node.health.quality')}</span>
              <b>
                {node.quality24h.valid} / {node.quality24h.expected}
              </b>
            </div>
            <div className="stat-row">
              <span>{t('node.health.rh')}</span>
              <b>{fmtNum(locale, node.health.enclosureRh, 0)}%</b>
            </div>
            <div className="stat-row" style={{ gridColumn: '1 / -1' }}>
              <span>{t('node.health.cleaning')}</span>
              <b style={{ color: cleaningDue ? 'var(--status-warning-ink)' : undefined }}>
                {fmtNum(locale, node.daysSinceCleaning, 0)}
                {cleaningDue && <span style={{ fontWeight: 450 }}> · {t('node.health.cleaningDue')}</span>}
              </b>
            </div>
          </div>
          {healthOpt && (
            <div style={{ marginTop: 8 }}>
              <EChart option={healthOpt} height={222} zoomKey={rk} label={t('node.health')} />
            </div>
          )}
          {series.data && series.data.maintenance.length > 0 && (
            <>
              <h3 className="panel-title" style={{ marginTop: 10, marginBottom: 4, fontSize: 14 }}>
                {t('node.maintenance')}
              </h3>
              <ul className="timeline">
                {[...series.data.maintenance].reverse().map((m) => (
                  <li key={`${m.t}-${m.kind}`}>
                    <time dateTime={new Date(m.t).toISOString()}>{fmtDay(locale, m.t)}</time>
                    <span>
                      <strong style={{ fontWeight: 560 }}>{t(`node.maint.${m.kind}`)}</strong>
                      <span className="muted"> — {m.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {lab.data && <LabPanel lab={lab.data} />}

      <section className="section" aria-labelledby="node-alerts-title">
        <div className="section-head">
          <h2 className="section-title" id="node-alerts-title">
            {t('node.alerts')}
          </h2>
        </div>
        <div className="alert-list">
          {nodeAlerts.length === 0 && <p className="muted">{alerts.loading ? t('common.loading') : t('common.none')}</p>}
          {nodeAlerts.slice(0, 8).map((a) => (
            <AlertCard key={a.id} alert={a} showNode={false} />
          ))}
        </div>
      </section>
    </>
  )
}
