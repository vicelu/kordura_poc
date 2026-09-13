import type { NodeSummary, Param } from '@shared/types'
import { Link } from 'react-router-dom'
import { fmtAgo, fmtNum, fmtParam, unitOf } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { RiskBadge, RiskIcon, StatusBadge } from './Badges'
import { NODE_COLOR_INDEX } from './charts/options'
import { IconBattery, IconClock, IconSignal, IconWrench } from './Icons'
import { Sparkline } from './Sparkline'

const CARD_PARAMS: Param[] = ['temp', 'salinity', 'ph', 'do_sat', 'turbidity', 'orp']

export const signalBars = (rssi: number) => (rssi > -95 ? 4 : rssi > -103 ? 3 : rssi > -110 ? 2 : 1)

export function NodeCard({ node, index }: { node: NodeSummary; index: number }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const color = tokens.series[NODE_COLOR_INDEX[node.id] ?? 0]
  const deviating = new Set(node.risk.drivers.filter((d) => Math.abs(d.z) >= 2.5).map((d) => d.param))
  const sig = node.risk.signature

  return (
    <article className="card node-card rise" style={{ ['--c' as string]: color, ['--i' as string]: 3 + index }}>
      <div className="node-card-head">
        <div>
          <div className="node-card-id">{node.id}</div>
          <h3 className="node-card-name place">
            <Link to={`/nodes/${node.id}`} aria-label={t('card.open', { name: `${node.id} ${node.name}` })}>
              {node.name}
            </Link>
          </h3>
          <div className="node-card-place">{node.nearField.map((n) => t(`near.${n}`)).join(' · ')}</div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="node-card-risk" data-level={node.risk.level}>
        <RiskIcon level={node.risk.level} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 560 }}>{sig ? t(`sig.${sig}`) : t('sig.none')}</div>
          {node.openAlerts > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t('card.alerts', { n: node.openAlerts })}</div>}
        </div>
        <RiskBadge level={node.risk.level} score={node.risk.score} />
      </div>

      <div className="readings">
        {CARD_PARAMS.map((p) => {
          const v = node.latest?.values[p] ?? null
          const d = node.delta24h[p]
          return (
            <div className="reading" key={p} data-dev={deviating.has(p)}>
              <div className="reading-label">
                <span>{t(`paramShort.${p}`)}</span>
                <span className="reading-delta" title={t('card.delta')}>
                  {fmtParam(locale, p, d, true)}
                </span>
              </div>
              <div className="reading-value">
                {fmtParam(locale, p, v)}
                <small>{unitOf(p)}</small>
              </div>
              <Sparkline values={node.spark[p]} color={deviating.has(p) ? tokens.status.critical : tokens.line} />
            </div>
          )
        })}
      </div>

      <div className="node-card-foot">
        <span className="foot-item" title={t('card.lastSeen')}>
          <IconClock size={14} />
          {node.lastSeen ? fmtAgo(t, node.lastSeen) : '—'}
        </span>
        <span className="foot-item" title={t('card.interval')}>
          {node.health.intervalMin} min{node.health.intervalMin === 5 ? ` · ${t('card.adaptive')}` : ''}
        </span>
        <span className="foot-item" title={t('card.battery')}>
          <IconBattery size={15} level={node.health.batteryPct / 100} />
          {fmtNum(locale, node.health.batteryPct, 0)}%
        </span>
        <span className="foot-item" title={`${t('card.signal')} RSSI / SNR`}>
          <IconSignal size={14} bars={signalBars(node.health.rssi)} />
          <span className="mono" style={{ fontSize: 11.5 }}>
            {node.health.rssi} dBm
          </span>
        </span>
        <span className="foot-item" title={t('card.cleaned')}>
          <IconWrench size={13} />
          {t('common.days', { v: fmtNum(locale, node.daysSinceCleaning, 0) })}
        </span>
      </div>
    </article>
  )
}
