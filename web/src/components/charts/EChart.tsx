import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useEffect, useRef } from 'react'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  GraphicComponent,
  CanvasRenderer,
])

interface Props {
  option: EChartsOption
  height: number
  group?: string
  label: string
  /** Zoom is preserved across option updates while this key stays the same (e.g. the selected time range). */
  zoomKey?: string
  onClick?: (params: echarts.ECElementEvent) => void
}

export function EChart({ option, height, group, label, zoomKey, onClick }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const lastZoomKey = useRef(zoomKey)
  const clickRef = useRef(onClick)
  clickRef.current = onClick

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = c
    c.on('click', (p) => clickRef.current?.(p as echarts.ECElementEvent))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const c = chart.current
    if (!c) return
    // Keep the user's zoom window across data refreshes.
    const prevZoom = (c.getOption() as { dataZoom?: { start?: number; end?: number }[] } | undefined)?.dataZoom?.[0]
    c.setOption(option, { notMerge: true, lazyUpdate: true })
    const sameRange = lastZoomKey.current === zoomKey
    lastZoomKey.current = zoomKey
    if (sameRange && prevZoom && (prevZoom.start !== 0 || prevZoom.end !== 100) && (option as { dataZoom?: unknown }).dataZoom) {
      c.dispatchAction({ type: 'dataZoom', start: prevZoom.start, end: prevZoom.end })
    }
  }, [option, zoomKey])

  useEffect(() => {
    const c = chart.current
    if (!c || !group) return
    c.group = group
    echarts.connect(group)
  }, [group])

  return <div ref={el} className="chart" style={{ height }} role="img" aria-label={label} />
}
