import type { AlertKind, AlertState, Assessment, NodeStatus, RiskLevel } from '@shared/types'
import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { IconCheck, IconEye, IconFlask, IconMinus, IconOctagon, IconTriangle, IconX } from './Icons'

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'outline'

export function Badge({ tone, icon, children, title }: { tone: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="badge" data-tone={tone} title={title}>
      {icon}
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: NodeStatus }) {
  const { t } = useI18n()
  const map = {
    online: { tone: 'good', icon: <IconCheck size={14} /> },
    degraded: { tone: 'warning', icon: <IconTriangle size={14} /> },
    offline: { tone: 'critical', icon: <IconX size={14} /> },
  } as const
  const m = map[status]
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {t(`status.${status}`)}
    </Badge>
  )
}

export const riskTone = (level: RiskLevel): Tone => ({ normal: 'good', watch: 'warning', elevated: 'serious', high: 'critical' } as const)[level]

export function RiskIcon({ level, size = 14 }: { level: RiskLevel; size?: number }) {
  if (level === 'normal') return <IconCheck size={size} />
  if (level === 'watch') return <IconEye size={size} />
  if (level === 'elevated') return <IconTriangle size={size} />
  return <IconOctagon size={size} />
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const { t } = useI18n()
  return (
    <Badge tone={riskTone(level)} icon={<RiskIcon level={level} />}>
      {t(`risk.${level}`)}
      {score !== undefined && <span className="mono" style={{ fontSize: 11, opacity: 0.8 }}>{score}</span>}
    </Badge>
  )
}

export const assessmentTone = (a: Assessment): Tone => ({ excellent: 'good', good: 'good', sufficient: 'warning', poor: 'critical' } as const)[a]

export function AssessmentBadge({ assessment }: { assessment: Assessment | null }) {
  const { t } = useI18n()
  if (!assessment)
    return (
      <Badge tone="outline" icon={<IconFlask size={13} />}>
        {t('common.pending')}
      </Badge>
    )
  const icon = assessment === 'poor' ? <IconOctagon size={13} /> : assessment === 'sufficient' ? <IconTriangle size={13} /> : <IconCheck size={13} />
  return (
    <Badge tone={assessmentTone(assessment)} icon={icon}>
      {t(`assess.${assessment}`)}
    </Badge>
  )
}

export function AlertStateBadge({ state }: { state: AlertState }) {
  const { t } = useI18n()
  const map: Record<AlertState, { tone: Tone; icon: ReactNode }> = {
    open: { tone: 'critical', icon: <IconOctagon size={13} /> },
    acknowledged: { tone: 'serious', icon: <IconEye size={13} /> },
    sampling: { tone: 'warning', icon: <IconFlask size={13} /> },
    confirmed: { tone: 'critical', icon: <IconFlask size={13} /> },
    refuted: { tone: 'neutral', icon: <IconMinus size={13} /> },
    closed: { tone: 'neutral', icon: <IconCheck size={13} /> },
  }
  const m = map[state]
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {t(`alerts.state.${state}`)}
    </Badge>
  )
}

export const WATER_QUALITY: AlertKind[] = ['runoff', 'organic']
