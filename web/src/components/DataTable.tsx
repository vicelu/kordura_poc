import { useEffect, useState, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

export interface Column<R> {
  key: string
  header: ReactNode
  num?: boolean
  render: (row: R) => ReactNode
}

/** Accessible table twin for charts and lists; paginates long series. */
export function DataTable<R>({ columns, rows, pageSize = 50, caption, rowKey }: { columns: Column<R>[]; rows: R[]; pageSize?: number; caption: string; rowKey: (r: R, i: number) => string }) {
  const { t } = useI18n()
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => {
    if (page >= pages) setPage(0)
  }, [page, pages])
  const slice = rows.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div>
      <div className="table-wrap" style={{ maxHeight: 520 }}>
        <table className="data">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.num ? 'num' : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {t('common.noData')}
                </td>
              </tr>
            )}
            {slice.map((r, i) => (
              <tr key={rowKey(r, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>{t('common.page', { p: page + 1, n: pages })}</span>
          <button className="btn" data-size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            {t('common.prev')}
          </button>
          <button className="btn" data-size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  )
}
