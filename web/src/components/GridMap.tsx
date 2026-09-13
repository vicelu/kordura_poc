import type { GridResponse } from '@shared/types'
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { NODE_COLOR_INDEX } from './charts/options'

// Standard OSM tiles, toned to the page with a CSS filter (see .map-tiles in styles.css).
// For production traffic, swap in a keyed tile provider — the OSM tile servers are for light use only.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export function GridMap({ grid }: { grid: GridResponse }) {
  const { t } = useI18n()
  const { tokens } = useTheme()
  const navigate = useNavigate()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView(grid.site.center, 15)
    map.current = m
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19, className: 'map-tiles' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    fitted.current = false
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()

    for (const lm of grid.landmarks) {
      L.marker([lm.lat, lm.lon], {
        icon: L.divIcon({ className: '', html: `<div class="lmark" data-kind="${lm.kind}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
        keyboard: false,
        title: t(`near.${lm.kind}`),
      })
        .bindTooltip(escapeHtml(t(`near.${lm.kind}`)), { direction: 'top', offset: [0, -8] })
        .addTo(g)
    }

    for (const n of grid.nodes) {
      const color = tokens.series[NODE_COLOR_INDEX[n.id] ?? 0]
      const label = `${n.id} ${n.name} — ${t(`status.${n.status}`)}, ${t(`risk.${n.risk.level}`)}`
      const marker = L.marker([n.lat, n.lon], {
        icon: L.divIcon({
          className: '',
          html: `<div class="kmark" data-risk="${n.risk.level}" style="--c:${color}"><div class="kmark-ring"></div><div class="kmark-label"><b>${escapeHtml(n.id)}</b>${escapeHtml(n.name)}</div></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        }),
        keyboard: true,
        title: label,
        alt: label,
        riseOnHover: true,
      })
      marker.on('click', () => navigate(`/nodes/${n.id}`))
      marker.on('keypress', (e) => {
        const key = (e as unknown as { originalEvent: KeyboardEvent }).originalEvent.key
        if (key === 'Enter' || key === ' ') navigate(`/nodes/${n.id}`)
      })
      marker.addTo(g)
    }

    if (!fitted.current) {
      const pts = [...grid.nodes.map((n) => [n.lat, n.lon]), ...grid.landmarks.map((l) => [l.lat, l.lon])] as [number, number][]
      m.fitBounds(L.latLngBounds(pts), { padding: [70, 90], maxZoom: 16 })
      fitted.current = true
    }
  }, [grid, tokens, t, navigate])

  return (
    <div className="card map-card rise" style={{ ['--i' as string]: 2 }}>
      <div ref={el} className="map" role="region" aria-label={t('grid.map')} />
      <div className="map-scale mono" aria-hidden="true">
        42°37′N · 18°12′E
      </div>
      <div className="map-legend">
        <div className="row">
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: `3px solid ${tokens.series[0]}`, display: 'inline-block', background: 'var(--surface)' }} />
          {t('grid.mapLegend.node')}
        </div>
        <div className="row">
          <span className="lmark" style={{ width: 11, height: 11, display: 'inline-block', margin: '0 2px' }} />
          {t('grid.mapLegend.landmark')}
        </div>
      </div>
    </div>
  )
}
