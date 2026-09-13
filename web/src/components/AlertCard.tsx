import type { Alert, NodeSummary } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fmtAgo, fmtDateTime, fmtDuration, fmtNum, fmtParam } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'
import { AlertStateBadge, RiskBadge, WATER_QUALITY } from './Badges'
import { NODE_COLOR_INDEX } from './charts/options'

const OPERATOR_KEY = 'kordura.operator'

function VerdictDialog({ alert, open, onClose, onSaved }: { alert: Alert; open: boolean; onClose: () => void; onSaved: (a: Alert) => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const [outcome, setOutcome] = useState<'confirmed' | 'refuted'>('confirmed')
  const [ecoli, setEcoli] = useState('')
  const [ent, setEnt] = useState('')
  const [note, setNote] = useState('')
  const [by, setBy] = useState(() => {
    try {
      return localStorage.getItem(OPERATOR_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby={`vd-${alert.id}`}>
      <form
        method="dialog"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            try {
              localStorage.setItem(OPERATOR_KEY, by)
            } catch {
              /* storage unavailable */
            }
            const saved = await api.verdict(alert.id, {
              outcome,
              ecoli: ecoli === '' ? null : Number(ecoli),
              enterococci: ent === '' ? null : Number(ent),
              note,
              by: by || 'operator',
            })
            onSaved(saved)
            onClose()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="modal-body">
          <h2 id={`vd-${alert.id}`} style={{ fontSize: 18 }}>
            {t('alerts.verdictTitle')}
          </h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field" style={{ marginBottom: 6 }}>
              {t('alerts.outcome')}
            </legend>
            <div className="seg">
              <button type="button" aria-pressed={outcome === 'confirmed'} onClick={() => setOutcome('confirmed')}>
                {t('alerts.confirmed')}
              </button>
              <button type="button" aria-pressed={outcome === 'refuted'} onClick={() => setOutcome('refuted')}>
                {t('alerts.refuted')}
              </button>
            </div>
          </fieldset>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field">
              {t('lab.ecoli')} ({t('lab.unit')})
              <input className="input" type="number" min={0} inputMode="numeric" value={ecoli} onChange={(e) => setEcoli(e.target.value)} />
            </label>
            <label className="field">
              {t('lab.ent')} ({t('lab.unit')})
              <input className="input" type="number" min={0} inputMode="numeric" value={ent} onChange={(e) => setEnt(e.target.value)} />
            </label>
          </div>
          <label className="field">
            {t('alerts.note')}
            <textarea className="input" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="field">
            {t('alerts.by')}
            <input className="input" value={by} maxLength={60} onChange={(e) => setBy(e.target.value)} autoComplete="name" />
          </label>
          {error && (
            <div className="error-banner" role="alert" style={{ margin: 0 }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn" data-variant="primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export function AlertCard({ alert: initial, node, showNode = true }: { alert: Alert; node?: NodeSummary; showNode?: boolean }) {
  const { t, locale } = useI18n()
  const { tokens } = useTheme()
  const [alert, setAlert] = useState(initial)
  const [dialog, setDialog] = useState(false)
  useEffect(() => setAlert(initial), [initial])

  const wq = WATER_QUALITY.includes(alert.kind)
  const active = alert.closedAt === null
  const barColor = alert.state === 'refuted' || alert.state === 'closed' ? 'var(--hairline-strong)' : `var(--status-${{ normal: 'good', watch: 'warning', elevated: 'serious', high: 'critical' }[alert.severity]})`
  const narrative = t(`narr.${alert.kind}`, { rain: fmtNum(locale, alert.rainMm24h, 0) })

  return (
    <article className="card alert-card" id={alert.id} style={{ ['--c' as string]: barColor }}>
      <div className="alert-card-bar" aria-hidden="true" />
      <div className="alert-card-body">
        <div className="alert-card-top">
          <h3 className="alert-card-title">{t(`sig.${alert.kind}`)}</h3>
          {wq && <RiskBadge level={alert.severity} score={alert.peakScore} />}
          <AlertStateBadge state={alert.state} />
          {showNode && node && (
            <Link to={`/nodes/${node.id}`} className="alert-card-node" style={{ marginLeft: 'auto' }}>
              <span className="swatch" style={{ ['--c' as string]: tokens.series[NODE_COLOR_INDEX[node.id] ?? 0] }} />
              <span className="mono" style={{ fontSize: 11.5 }}>
                {node.id}
              </span>
              <span className="place" style={{ fontSize: 15 }}>
                {node.name}
              </span>
            </Link>
          )}
        </div>
        <p className="ink2" style={{ fontSize: 14 }}>
          {narrative}
        </p>
        <dl className="alert-card-grid">
          <div>
            <dt>{t('alerts.opened')}</dt>
            <dd className="mono" style={{ fontSize: 12.5 }}>
              {fmtDateTime(locale, alert.openedAt)}
            </dd>
          </div>
          <div>
            <dt>{t('alerts.duration')}</dt>
            <dd>{active ? `${fmtDuration(t, Date.now() - alert.openedAt)} · ${t('alerts.ongoing')}` : fmtDuration(t, (alert.closedAt as number) - alert.openedAt)}</dd>
          </div>
          {wq && (
            <div>
              <dt>{t('alerts.rain')}</dt>
              <dd>{fmtNum(locale, alert.rainMm24h, 1)} mm</dd>
            </div>
          )}
          {alert.verdict && (
            <div>
              <dt>{t('lab.ecoli')} / {t('lab.ent')}</dt>
              <dd>
                {alert.verdict.ecoli ?? '—'} / {alert.verdict.enterococci ?? '—'} <span className="muted" style={{ fontWeight: 400 }}>{t('lab.unit')}</span>
              </dd>
            </div>
          )}
          {alert.leadTimeH !== null && (
            <div>
              <dt>{t('alerts.leadTime')}</dt>
              <dd>{t('common.hours', { v: alert.leadTimeH })}</dd>
            </div>
          )}
        </dl>
        {alert.drivers.length > 0 && (
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              {t('alerts.drivers')}
            </div>
            <div className="drivers">
              {alert.drivers.map((d) => (
                <span className="driver" key={d.param}>
                  {d.param === 'rain' ? t('param.rain') : t(`param.${d.param}`)}
                  <span className="mono">
                    {d.param === 'rain' ? fmtNum(locale, d.delta, 1) : fmtParam(locale, d.param, d.delta, true)} · z {fmtNum(locale, d.z, 1, true)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="alert-card-actions">
          {alert.ack ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              {t('alerts.acked', { by: alert.ack.by, ago: fmtAgo(t, alert.ack.at) })}
            </span>
          ) : (
            active && (
              <button
                className="btn"
                data-size="sm"
                onClick={async () => {
                  let by = 'operator'
                  try {
                    by = localStorage.getItem(OPERATOR_KEY) || by
                  } catch {
                    /* storage unavailable */
                  }
                  setAlert(await api.ack(alert.id, by))
                }}
              >
                {t('alerts.ack')}
              </button>
            )
          )}
          {wq && !alert.verdict && (
            <button className="btn" data-size="sm" data-variant="primary" onClick={() => setDialog(true)}>
              {t('alerts.verdict')}
            </button>
          )}
          {showNode && node && (
            <Link to={`/nodes/${node.id}?from=${alert.openedAt - 36 * 3_600_000}&to=${Math.min(Date.now(), (alert.closedAt ?? Date.now()) + 36 * 3_600_000)}`} style={{ fontSize: 13, marginLeft: 'auto' }}>
              {t('alerts.view')} →
            </Link>
          )}
        </div>
      </div>
      {wq && <VerdictDialog alert={alert} open={dialog} onClose={() => setDialog(false)} onSaved={setAlert} />}
    </article>
  )
}
