import { useCallback, useEffect, useRef, useState } from 'react'
import type { Alert, AlertsResponse, CompareResponse, EnvSeriesResponse, GridResponse, LabSample, Param, SeriesResponse, TsResponse } from '@shared/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Static build for GitHub Pages: the simulation runs in the browser instead of behind `/api`. */
export const isDemo = import.meta.env.VITE_DEMO === '1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (isDemo) {
    const { demoRequest, DemoError } = await import('./demo')
    return demoRequest<T>(path, init).catch((e) => {
      throw e instanceof DemoError ? new ApiError(e.status, e.message) : e
    })
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = (await res.json()).error ?? message
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

const qs = (o: Record<string, string | number | undefined>) =>
  '?' + Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

export const api = {
  grid: () => request<GridResponse>('/grid'),
  series: (id: string, from: number, to: number) => request<SeriesResponse>(`/nodes/${id}${qs({ from, to })}`),
  lab: (id: string) => request<LabSample[]>(`/nodes/${id}/lab`),
  ts: (id: string, days: number) => request<TsResponse>(`/nodes/${id}/ts${qs({ days })}`),
  environment: (from: number, to: number) => request<EnvSeriesResponse>(`/environment${qs({ from, to })}`),
  compare: (param: Param, from: number, to: number) => request<CompareResponse>(`/compare${qs({ param, from, to })}`),
  alerts: () => request<AlertsResponse>('/alerts'),
  ack: (id: string, by: string) => request<Alert>(`/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST', body: JSON.stringify({ by }) }),
  verdict: (id: string, body: { outcome: 'confirmed' | 'refuted'; ecoli: number | null; enterococci: number | null; note: string; by: string }) =>
    request<Alert>(`/alerts/${encodeURIComponent(id)}/verdict`, { method: 'POST', body: JSON.stringify(body) }),
  exportUrl: (id: string, from: number, to: number, params: Param[]) => `/api/nodes/${id}/export.csv${qs({ from, to, params: params.join(',') })}`,
  /** In the demo there is no server to follow `exportUrl`, so the CSV is built and saved in the browser. */
  demoDownload: (href: string) => import('./demo').then((m) => m.demoDownload(href)),
}

export interface Resource<T> {
  data: T | null
  error: Error | null
  loading: boolean
  updatedAt: number | null
  reload: () => void
}

/**
 * Fetches on mount and whenever `key` changes, then re-polls. Previous data is kept while refetching,
 * so charts dim instead of flashing a skeleton.
 */
export function usePolling<T>(fetcher: () => Promise<T>, key: string, intervalMs = 60_000): Resource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const load = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    fetcherRef
      .current()
      .then((d) => {
        if (id !== seq.current) return
        setData(d)
        setError(null)
        setUpdatedAt(Date.now())
      })
      .catch((e: Error) => {
        if (id === seq.current) setError(e)
      })
      .finally(() => {
        if (id === seq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    if (!intervalMs) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, intervalMs)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, intervalMs, load])

  return { data, error, loading, updatedAt, reload: load }
}
