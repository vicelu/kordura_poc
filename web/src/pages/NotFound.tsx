import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'

export function NotFound() {
  const { t } = useI18n()
  return (
    <div className="empty" style={{ paddingBlock: 120 }}>
      <h1 className="place" style={{ fontSize: 56, fontWeight: 380, color: 'var(--ink)' }}>
        {t('notFound.title')}
      </h1>
      <p style={{ marginTop: 10 }}>{t('notFound.body')}</p>
      <p style={{ marginTop: 18 }}>
        <Link to="/">{t('notFound.back')}</Link>
      </p>
    </div>
  )
}
