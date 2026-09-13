import type { EChartsOption } from 'echarts'
import {
  QC,
  type Alert,
  type CompareResponse,
  type EnvSeriesResponse,
  type LabSample,
  type Param,
  type Regime,
  type SeriesResponse,
  type TsResponse,
} from '@shared/types'
import { axisTimeLabel, fmtDateTime, fmtNum, fmtParam, unitOf } from '../../lib/format'
import type { Key } from '../../lib/i18n'
import type { ChartTokens } from '../../lib/theme'

type T = (key: Key, vars?: Record<string, string | number>) => string
interface Ctx {
  tk: ChartTokens
  t: T
  locale: string
}

const axisFmt = new Map<string, Intl.NumberFormat>()
const fmtAxisNum = (locale: string, v: number, maxDecimals: number) => {
  const k = `${locale}|${maxDecimals}`
  if (!axisFmt.has(k)) axisFmt.set(k, new Intl.NumberFormat(locale, { maximumFractionDigits: maxDecimals }))
  return (axisFmt.get(k) as Intl.NumberFormat).format(v).replace('-', '−')
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export const NODE_COLOR_INDEX: Record<string, 0 | 1 | 2> = { 'KRD-01': 0, 'KRD-02': 1, 'KRD-03': 2 }

export const regimeColor = (tk: ChartTokens, r: Regime, soft = false) =>
  r === 'marine' ? (soft ? tk.wash : tk.muted) : (soft ? tk.seriesSoft : tk.series)[{ freshwater: 0, runoff: 1, upwelling: 2 }[r] as 0 | 1 | 2]

function tooltipBase(tk: ChartTokens) {
  return {
    backgroundColor: tk.surface,
    borderColor: tk.grid,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tk.ink, fontFamily: tk.font, fontSize: 12.5 },
    extraCssText: `box-shadow: 0 10px 30px -12px rgba(0,0,0,.35); border-radius: 8px;`,
    confine: true,
  }
}

function timeAxis(ctx: Ctx, from: number, to: number, opts: { show?: boolean; gridIndex?: number } = {}) {
  const { tk, locale } = ctx
  return {
    type: 'time' as const,
    gridIndex: opts.gridIndex ?? 0,
    min: from,
    max: to,
    axisLine: { lineStyle: { color: tk.axis } },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: tk.grid, width: 1 } },
    axisLabel: {
      show: opts.show ?? true,
      color: tk.muted,
      fontFamily: tk.mono,
      fontSize: 10.5,
      hideOverlap: true,
      formatter: axisTimeLabel(locale, to - from),
    },
    axisPointer: { lineStyle: { color: tk.ink2, width: 1 }, label: { show: false } },
  }
}

function valueAxis(ctx: Ctx, opts: { gridIndex?: number; min?: number | ((v: { min: number; max: number }) => number); max?: number | ((v: { min: number; max: number }) => number); decimals?: number; splitNumber?: number; name?: string } = {}) {
  const { tk, locale } = ctx
  return {
    type: 'value' as const,
    gridIndex: opts.gridIndex ?? 0,
    scale: true,
    min: opts.min,
    max: opts.max,
    splitNumber: opts.splitNumber ?? 3,
    name: opts.name,
    nameLocation: 'end' as const,
    nameGap: 6,
    nameTextStyle: { color: tk.ink2, fontFamily: tk.font, fontSize: 11.5, align: 'left' as const, padding: [0, 0, 0, -44] },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: tk.grid, width: 1 } },
    axisLabel: {
      color: tk.muted,
      fontFamily: tk.mono,
      fontSize: 10.5,
      // Up to the requested precision, trimming trailing zeros, so tick steps like 0.5 never collapse into duplicates.
      formatter: (v: number) => fmtAxisNum(locale, v, opts.decimals ?? 2),
    },
  }
}

const zoom = (xAxisIndex: number[] = [0]) => [{ type: 'inside' as const, xAxisIndex, filterMode: 'none' as const, zoomOnMouseWheel: 'shift' as const, moveOnMouseWheel: false, moveOnMouseMove: true, preventDefaultMouseMove: false }]

// ---------------------------------------------------------------- parameter series

export interface Overlays {
  regimes: boolean
  baseline: boolean
  maintenance: boolean
  qc: boolean
}

export function paramOption(ctx: Ctx, d: SeriesResponse, p: Param, ov: Overlays): EChartsOption {
  const { tk, t, locale } = ctx
  const agg = d.resolution !== 'raw'
  const line = d.t.map((x, i) => [x, d.values[p][i]] as [number, number | null])
  const series: EChartsOption['series'] = []

  if (agg && d.min[p] && d.max[p]) {
    const mins = d.min[p]!
    const maxs = d.max[p]!
    series.push({
      name: 'min',
      type: 'line',
      data: d.t.map((x, i) => [x, mins[i]]),
      stack: 'band',
      symbol: 'none',
      lineStyle: { width: 0 },
      silent: true,
      tooltip: { show: false },
      connectNulls: false,
    })
    series.push({
      name: 'range',
      type: 'line',
      data: d.t.map((x, i) => [x, mins[i] === null || maxs[i] === null ? null : (maxs[i] as number) - (mins[i] as number)]),
      stack: 'band',
      symbol: 'none',
      lineStyle: { width: 0 },
      areaStyle: { color: tk.lineSoft },
      silent: true,
      tooltip: { show: false },
      connectNulls: false,
    })
  }

  const markAreas: unknown[] = []
  if (ov.baseline) {
    const b = d.baseline[p]
    markAreas.push([{ yAxis: b.p10, itemStyle: { color: tk.band } }, { yAxis: b.p90 }])
  }
  if (ov.regimes) {
    // On aggregated (multi-week) views, short daily pulses would be noise; keep only sustained regimes.
    const minMs = agg ? 6 * 3_600_000 : 0
    for (const r of d.regimes.filter((x) => x.to - x.from >= minMs)) markAreas.push([{ xAxis: r.from, itemStyle: { color: regimeColor(tk, r.regime, true) } }, { xAxis: Math.max(r.to, r.from + 20 * 60_000) }])
  }
  for (const g of d.gaps) markAreas.push([{ xAxis: g.from, itemStyle: { color: tk.wash } }, { xAxis: g.to }])

  const markLines = ov.maintenance
    ? d.maintenance.filter((m) => m.t >= d.from && m.t <= d.to).map((m) => ({ xAxis: m.t, name: t(`node.maint.${m.kind}`) }))
    : []

  series.push({
    name: t(`param.${p}`),
    type: 'line',
    data: line,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 6,
    sampling: line.length > 3000 ? 'lttb' : undefined,
    connectNulls: false,
    lineStyle: { width: 1.6, color: tk.line },
    itemStyle: { color: tk.line },
    emphasis: { disabled: true },
    markArea: { silent: true, data: markAreas as never },
    markLine: markLines.length
      ? {
          silent: false,
          symbol: 'none',
          lineStyle: { color: tk.ink2, width: 1, type: 'solid', opacity: 0.55 },
          label: { show: false },
          emphasis: { label: { show: true, formatter: '{b}', color: tk.ink, fontFamily: tk.font, fontSize: 11, position: 'insideEndTop' } },
          data: markLines as never,
        }
      : undefined,
  })

  if (ov.qc) {
    const flagged = d.t
      .map((x, i) => [x, d.values[p][i], d.qc[i]] as const)
      // Spike detection runs on the optical turbidity channel only; range and settling flags apply to every channel.
      .filter(([, v, q]) => v !== null && q & ((p === 'turbidity' ? QC.SPIKE : 0) | QC.RANGE | QC.SETTLING))
      .map(([x, v]) => [x, v])
    if (flagged.length && !agg)
      series.push({
        name: 'qc',
        type: 'scatter',
        data: flagged,
        symbol: 'emptyCircle',
        symbolSize: 7,
        itemStyle: { color: tk.status.serious, borderWidth: 1.5 },
        tooltip: { show: false },
        z: 5,
      })
  }

  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: { left: 50, right: 14, top: 10, bottom: 22 },
    xAxis: timeAxis(ctx, d.from, d.to),
    yAxis: valueAxis(ctx, { decimals: p === 'ph' ? 2 : undefined }),
    dataZoom: zoom(),
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: tk.ink2 } },
      formatter: (items: unknown) => {
        const arr = (items as { seriesName: string; dataIndex: number; value: [number, number | null] }[]).filter((i) => i.seriesName === t(`param.${p}`))
        if (!arr.length) return ''
        const i = arr[0].dataIndex
        const x = d.t[i]
        const v = d.values[p][i]
        const range = agg && d.min[p]?.[i] !== null && d.min[p]?.[i] !== undefined
          ? `<div style="color:${tk.muted};font-size:11.5px">min ${fmtParam(locale, p, d.min[p]![i])} · max ${fmtParam(locale, p, d.max[p]![i])}</div>`
          : ''
        const flags = d.qc[i] & (QC.SPIKE | QC.RANGE | QC.SETTLING | QC.BACKFILL | QC.ADAPTIVE)
        const flagText = [
          d.qc[i] & QC.SPIKE ? 'spike' : '',
          d.qc[i] & QC.SETTLING ? 'settling' : '',
          d.qc[i] & QC.RANGE ? 'out of range' : '',
          d.qc[i] & QC.BACKFILL ? 'backfilled' : '',
          d.qc[i] & QC.ADAPTIVE ? '5-min' : '',
        ].filter(Boolean).join(' · ')
        return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted};margin-bottom:3px">${esc(fmtDateTime(locale, x))}</div>
          <div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:12px;height:2px;background:${tk.line}"></span>
          <b style="font-size:14px">${esc(fmtParam(locale, p, v))}</b><span style="color:${tk.muted}">${esc(unitOf(p))}</span></div>${range}
          ${flags && !agg ? `<div style="color:${tk.muted};font-size:11px;margin-top:2px">${esc(flagText)}</div>` : ''}`
      },
    },
    series,
  }
}

// ---------------------------------------------------------------- risk index + lab lanes

const SOURCE_LANES: LabSample['source'][] = ['official', 'reference', 'orientation']

export function riskOption(ctx: Ctx, d: SeriesResponse): EChartsOption {
  const { tk, t, locale } = ctx
  const sevColor = (a: Alert) =>
    ({ normal: tk.wash, watch: `${tk.status.warning}26`, elevated: `${tk.status.serious}2e`, high: `${tk.status.critical}24` })[a.severity]
  const assessColor = (l: LabSample) =>
    !l.assessment ? tk.muted : { excellent: tk.status.good, good: tk.status.good, sufficient: tk.status.warning, poor: tk.status.critical }[l.assessment]
  const symbolFor = (l: LabSample) => ({ official: 'rect', reference: 'circle', orientation: 'diamond' })[l.source]
  const lab = d.lab

  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: [
      { left: 96, right: 14, top: 6, height: 54 },
      { left: 96, right: 14, top: 72, bottom: 22 },
    ],
    xAxis: [timeAxis(ctx, d.from, d.to, { show: false, gridIndex: 0 }), timeAxis(ctx, d.from, d.to, { gridIndex: 1 })],
    yAxis: [
      {
        type: 'category',
        gridIndex: 0,
        data: SOURCE_LANES.map((s) => t(`lab.src.${s}`)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tk.muted, fontSize: 10.5, fontFamily: tk.font },
        splitLine: { show: true, lineStyle: { color: tk.grid } },
      },
      { ...valueAxis(ctx, { gridIndex: 1, min: 0, max: 100, splitNumber: 2, decimals: 0 }), scale: false },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoom([0, 1]),
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'item',
      formatter: (p: unknown) => {
        const item = p as { seriesName: string; dataIndex: number; data: unknown }
        if (item.seriesName === 'lab') {
          const l = lab[item.dataIndex]
          const val = l.ecoli === null ? t('common.pending') : `E. coli <b>${l.ecoli}</b> · ${esc(t('lab.ent'))} <b>${l.enterococci}</b>`
          return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted}">${esc(fmtDateTime(locale, l.t))}</div>
            <div style="font-weight:600;margin:2px 0">${esc(t(`lab.src.${l.source}`))} · ${esc(t(`lab.trg.${l.trigger}`))}</div>
            <div>${val} <span style="color:${tk.muted}">${esc(t('lab.unit'))}</span></div>
            ${l.assessment ? `<div style="margin-top:2px">${esc(t(`assess.${l.assessment}`))}</div>` : ''}`
        }
        if (item.seriesName === 'risk') {
          const [x, v] = item.data as [number, number]
          return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted}">${esc(fmtDateTime(locale, x))}</div><b>${fmtNum(locale, v, 0)}</b> / 100`
        }
        return ''
      },
    },
    series: [
      {
        name: 'risk',
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: d.t.map((x, i) => [x, d.risk[i]]),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.6, color: tk.ink },
        itemStyle: { color: tk.ink },
        areaStyle: { color: tk.wash },
        triggerLineEvent: true,
        markLine: {
          silent: true,
          symbol: 'none',
          label: { position: 'insideStartTop', color: tk.muted, fontSize: 10.5, fontFamily: tk.font, formatter: '{b}' },
          lineStyle: { color: tk.axis, type: 'solid', width: 1 },
          data: [
            { yAxis: 20, name: t('risk.watch') },
            { yAxis: 40, name: t('risk.elevated') },
            { yAxis: 65, name: t('risk.high') },
          ],
        },
        markArea: {
          silent: true,
          label: { show: false },
          data: d.alerts
            .filter((a) => a.kind === 'runoff' || a.kind === 'organic')
            .map((a) => [
              { xAxis: a.openedAt, name: t(`sig.${a.kind}`), itemStyle: { color: sevColor(a) } },
              { xAxis: a.closedAt ?? d.to },
            ]) as never,
        },
      },
      {
        name: 'lab',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: lab.map((l) => ({
          value: [l.t, t(`lab.src.${l.source}`)],
          symbol: symbolFor(l),
          symbolSize: l.trigger === 'sensor_alert' ? 12 : 9,
          itemStyle: {
            color: l.assessment ? assessColor(l) : tk.surface,
            borderColor: l.assessment ? tk.surface : tk.ink2,
            borderWidth: 1.5,
          },
        })),
        z: 4,
      },
    ],
  }
}

// ---------------------------------------------------------------- environment

export function envOption(ctx: Ctx, e: EnvSeriesResponse, from: number, to: number): EChartsOption {
  const { tk, t, locale } = ctx
  const rows = [
    { key: 'rain', name: t('node.env.rain') },
    { key: 'wind', name: t('node.env.wind') },
    { key: 'tide', name: t('node.env.tide') },
    { key: 'hpp', name: t('node.env.hpp') },
  ]
  const top0 = ENV_TOP
  const h = ENV_ROW
  const gap = ENV_GAP
  const grids = rows.map((_, i) => ({ left: 50, right: 14, top: top0 + i * (h + gap), height: h }))
  const barWidth = Math.max(1, Math.min(8, 900 / Math.max(1, e.t.length)))
  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: grids,
    xAxis: rows.map((_, i) => timeAxis(ctx, from, to, { gridIndex: i, show: i === rows.length - 1 })),
    yAxis: rows.map((r, i) => ({
      ...valueAxis(ctx, { gridIndex: i, splitNumber: 2, min: r.key === 'rain' || r.key === 'wind' || r.key === 'hpp' ? 0 : undefined, max: r.key === 'hpp' ? 1 : undefined, name: r.name, decimals: r.key === 'tide' || r.key === 'hpp' ? 2 : 0 }),
      nameGap: 12,
      scale: r.key === 'tide',
    })),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoom(rows.map((_, i) => i)),
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: tk.ink2 } },
      formatter: (items: unknown) => {
        const arr = items as { dataIndex: number }[]
        if (!arr.length) return ''
        const i = arr[0].dataIndex
        const row = (label: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:${tk.muted}">${esc(label)}</span><b>${v}</b></div>`
        return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted};margin-bottom:3px">${esc(fmtDateTime(locale, e.t[i]))}</div>
          ${row(t('node.env.rain'), fmtNum(locale, e.rainMm[i], 1))}
          ${row(t('node.env.wind'), `${fmtNum(locale, e.windMs[i], 1)} · ${Math.round(e.windDir[i])}°`)}
          ${row(t('node.env.tide'), fmtNum(locale, e.tideM[i], 2))}
          ${row(t('node.env.hpp'), fmtNum(locale, e.hpp[i], 2))}`
      },
    },
    series: [
      { type: 'bar', xAxisIndex: 0, yAxisIndex: 0, data: e.t.map((x, i) => [x, e.rainMm[i]]), barWidth, itemStyle: { color: tk.series[0], borderRadius: [2, 2, 0, 0] } },
      { type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: e.t.map((x, i) => [x, e.windMs[i]]), showSymbol: false, lineStyle: { width: 1.5, color: tk.line }, itemStyle: { color: tk.line } },
      { type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: e.t.map((x, i) => [x, e.tideM[i]]), showSymbol: false, lineStyle: { width: 1.5, color: tk.line }, itemStyle: { color: tk.line } },
      { type: 'line', xAxisIndex: 3, yAxisIndex: 3, step: 'middle', data: e.t.map((x, i) => [x, e.hpp[i]]), showSymbol: false, lineStyle: { width: 1.2, color: tk.series[0] }, areaStyle: { color: tk.seriesSoft[0] }, itemStyle: { color: tk.series[0] } },
    ],
  }
}

const ENV_TOP = 26
const ENV_ROW = 58
const ENV_GAP = 44
export const ENV_HEIGHT = ENV_TOP + 4 * ENV_ROW + 3 * ENV_GAP + 30

// ---------------------------------------------------------------- T–S diagram

export function tsOption(ctx: Ctx, d: TsResponse): EChartsOption {
  const { tk, t, locale } = ctx
  const regimes: Regime[] = ['marine', 'freshwater', 'runoff', 'upwelling']
  const pts = d.points
  const sal = pts.map((p) => p.salinity)
  const tem = pts.map((p) => p.temp)
  const sMin = Math.min(...sal)
  const sMax = Math.max(...sal)
  const tMin = Math.min(...tem)
  const tMax = Math.max(...tem)
  const marine = pts.filter((p) => p.regime === 'marine')
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)] ?? 0
  }
  const m0 = marine.length ? { s: med(marine.map((p) => p.salinity)), t: med(marine.map((p) => p.temp)) } : null
  // Mixing line from the marine end-member towards cold karst freshwater (S≈0.3, T≈13.2 °C), clipped to the view.
  const fw = { s: 0.3, t: 13.2 }
  const sEnd = Math.max(sMin - 0.5, 0)
  const mix = m0 ? [[m0.s, m0.t], [sEnd, m0.t + ((sEnd - m0.s) / (fw.s - m0.s)) * (fw.t - m0.t)]] : []
  const latest = pts.length ? pts[pts.length - 1] : null

  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: { left: 50, right: 18, top: 16, bottom: 40 },
    xAxis: {
      type: 'value',
      name: `${t('param.salinity')} (PSU)`,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: tk.ink2, fontSize: 11.5 },
      min: Math.floor(sMin - 0.5),
      max: Math.ceil(sMax + 0.2),
      axisLine: { lineStyle: { color: tk.axis } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: tk.grid } },
      axisLabel: { color: tk.muted, fontFamily: tk.mono, fontSize: 10.5 },
    },
    yAxis: {
      type: 'value',
      name: `${t('param.temp')} (°C)`,
      nameTextStyle: { color: tk.ink2, fontSize: 11.5, align: 'left', padding: [0, 0, 0, -44] },
      min: Math.floor(tMin - 0.3),
      max: Math.ceil(tMax + 0.3),
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: tk.grid } },
      axisLabel: { color: tk.muted, fontFamily: tk.mono, fontSize: 10.5 },
    },
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'item',
      formatter: (p: unknown) => {
        const item = p as { seriesName: string; data: [number, number, number] }
        if (!Array.isArray(item.data) || item.data.length < 3) return ''
        return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted}">${esc(fmtDateTime(locale, item.data[2]))}</div>
          <div><b>${fmtNum(locale, item.data[1], 2)}</b> °C · <b>${fmtNum(locale, item.data[0], 2)}</b> PSU</div>
          <div style="color:${tk.muted}">${esc(item.seriesName)}</div>`
      },
    },
    series: [
      ...regimes.map((r) => ({
        name: t(`regime.${r}`),
        type: 'scatter' as const,
        data: pts.filter((p) => p.regime === r).map((p) => [p.salinity, p.temp, p.t]),
        symbolSize: r === 'marine' ? 4 : 5,
        large: true,
        largeThreshold: 4000,
        itemStyle: { color: regimeColor(tk, r), opacity: r === 'marine' ? 0.35 : 0.75 },
        emphasis: { scale: 1.8 },
      })),
      {
        name: t('node.tsMixing'),
        type: 'line' as const,
        data: mix,
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { color: tk.ink2, width: 1, type: 'dashed' as const },
        z: 1,
      },
      ...(latest
        ? [
            {
              name: t('node.tsLatest'),
              type: 'scatter' as const,
              data: [[latest.salinity, latest.temp, latest.t]],
              symbolSize: 14,
              itemStyle: { color: 'transparent', borderColor: tk.ink, borderWidth: 2 },
              z: 10,
            },
          ]
        : []),
    ],
  }
}

// ---------------------------------------------------------------- node health

export function healthOption(ctx: Ctx, d: SeriesResponse): EChartsOption {
  const { tk, t, locale } = ctx
  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: [
      { left: 50, right: 14, top: 22, height: 70 },
      { left: 50, right: 14, top: 124, height: 70 },
    ],
    xAxis: [timeAxis(ctx, d.from, d.to, { gridIndex: 0, show: false }), timeAxis(ctx, d.from, d.to, { gridIndex: 1 })],
    yAxis: [
      { ...valueAxis(ctx, { gridIndex: 0, min: 0, max: 100, splitNumber: 2, decimals: 0, name: `${t('node.health.battery')} (%)` }), scale: false },
      valueAxis(ctx, { gridIndex: 1, splitNumber: 2, decimals: 0, name: `${t('node.health.rssi')} (dBm)` }),
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoom([0, 1]),
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'axis',
      formatter: (items: unknown) => {
        const arr = items as { dataIndex: number }[]
        if (!arr.length) return ''
        const i = arr[0].dataIndex
        return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted};margin-bottom:3px">${esc(fmtDateTime(locale, d.t[i]))}</div>
          <div>${esc(t('node.health.battery'))} <b>${fmtNum(locale, d.health.batteryPct[i], 0)}%</b></div>
          <div>${esc(t('node.health.rssi'))} <b>${fmtNum(locale, d.health.rssi[i], 0)} dBm</b> · SNR <b>${fmtNum(locale, d.health.snr[i], 1)} dB</b></div>`
      },
    },
    series: [
      { type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: d.t.map((x, i) => [x, d.health.batteryPct[i]]), showSymbol: false, connectNulls: false, lineStyle: { width: 1.5, color: tk.line }, itemStyle: { color: tk.line }, areaStyle: { color: tk.lineSoft } },
      { type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: d.t.map((x, i) => [x, d.health.rssi[i]]), showSymbol: false, connectNulls: false, sampling: 'lttb', lineStyle: { width: 1.2, color: tk.line }, itemStyle: { color: tk.line } },
    ],
  }
}

// ---------------------------------------------------------------- compare nodes

export function compareOption(ctx: Ctx, c: CompareResponse, env: EnvSeriesResponse | null, names: Record<string, string>, plotHeight: number): EChartsOption {
  const { tk, t, locale } = ctx
  const ids = Object.keys(c.series)
  const hasEnv = !!env

  // Direct end labels: push apart labels whose last values would land within 14 px of each other.
  const all = ids.flatMap((id) => c.series[id].filter((v): v is number => v !== null))
  const vMin = Math.min(...all)
  const vMax = Math.max(...all)
  const plotPx = plotHeight - 12 - (hasEnv ? 96 : 24)
  const lasts = ids
    .map((id) => ({ id, v: [...c.series[id]].reverse().find((v) => v !== null) ?? null }))
    .filter((x): x is { id: string; v: number } => x.v !== null)
    .map((x) => ({ id: x.id, y: vMax > vMin ? ((vMax - x.v) / (vMax - vMin)) * plotPx : 0 }))
    .sort((a, b) => a.y - b.y)
  const labelOffsets: Record<string, number> = {}
  let prevY = -Infinity
  for (const l of lasts) {
    const y = Math.max(l.y, prevY + 14)
    labelOffsets[l.id] = y - l.y
    prevY = y
  }

  return {
    animation: false,
    textStyle: { fontFamily: tk.font },
    grid: [{ left: 50, right: 86, top: 12, bottom: hasEnv ? 96 : 24 }, ...(hasEnv ? [{ left: 50, right: 86, height: 46, bottom: 24 }] : [])],
    xAxis: [timeAxis(ctx, c.from, c.to, { show: !hasEnv }), ...(hasEnv ? [timeAxis(ctx, c.from, c.to, { gridIndex: 1 })] : [])],
    yAxis: [
      valueAxis(ctx, { decimals: c.param === 'ph' ? 2 : undefined }),
      ...(hasEnv ? [{ ...valueAxis(ctx, { gridIndex: 1, min: 0, splitNumber: 1, decimals: 0, name: t('node.env.rain') }), scale: false }] : []),
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    dataZoom: zoom(hasEnv ? [0, 1] : [0]),
    tooltip: {
      ...tooltipBase(tk),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: tk.ink2 } },
      formatter: (items: unknown) => {
        const arr = (items as { seriesId?: string; dataIndex: number; axisIndex?: number; seriesType: string }[]).filter((i) => i.seriesType === 'line')
        if (!arr.length) return ''
        const i = arr[0].dataIndex
        const rows = ids
          .map((id) => ({ id, v: c.series[id][i] }))
          .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
          .map(
            ({ id, v }) =>
              `<div style="display:flex;align-items:center;gap:8px"><span style="display:inline-block;width:12px;height:2px;background:${tk.series[NODE_COLOR_INDEX[id] ?? 0]}"></span><b style="min-width:52px">${esc(fmtParam(locale, c.param, v))}</b><span style="color:${tk.ink2}">${esc(names[id] ?? id)}</span></div>`,
          )
          .join('')
        return `<div style="font-family:${esc(tk.mono)};font-size:11px;color:${tk.muted};margin-bottom:4px">${esc(fmtDateTime(locale, c.t[i]))} · ${esc(unitOf(c.param))}</div>${rows}`
      },
    },
    series: [
      ...ids.map((id) => ({
        id,
        name: names[id] ?? id,
        type: 'line' as const,
        data: c.t.map((x, i) => [x, c.series[id][i]]),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.8, color: tk.series[NODE_COLOR_INDEX[id] ?? 0] },
        itemStyle: { color: tk.series[NODE_COLOR_INDEX[id] ?? 0] },
        emphasis: { focus: 'series' as const },
        endLabel: { show: true, formatter: names[id] ?? id, color: tk.ink2, fontFamily: tk.font, fontSize: 11.5, distance: 6, offset: [0, labelOffsets[id] ?? 0] },
      })),
      ...(hasEnv
        ? [
            {
              type: 'bar' as const,
              xAxisIndex: 1,
              yAxisIndex: 1,
              data: env!.t.map((x, i) => [x + 30 * 60_000, env!.rainMm[i]]),
              barWidth: Math.max(1, Math.min(6, 600 / Math.max(1, env!.t.length))),
              itemStyle: { color: tk.muted, borderRadius: [2, 2, 0, 0] },
              silent: true,
            },
          ]
        : []),
    ],
  }
}
