// Contract between the Kordura API and the web interface.

export const PARAMS = ['temp', 'salinity', 'conductivity', 'ph', 'do_sat', 'do_mgl', 'turbidity', 'orp'] as const
export type Param = (typeof PARAMS)[number]

export type Values = Record<Param, number | null>

export interface ParamMeta {
  key: Param
  unit: string
  decimals: number
  /** Plausible physical range, used for QC "out of range" flags and axis hints. */
  range: [number, number]
}

export const PARAM_META: Record<Param, ParamMeta> = {
  temp: { key: 'temp', unit: '°C', decimals: 2, range: [5, 35] },
  salinity: { key: 'salinity', unit: 'PSU', decimals: 2, range: [0, 42] },
  conductivity: { key: 'conductivity', unit: 'mS/cm', decimals: 1, range: [0, 70] },
  ph: { key: 'ph', unit: 'pH', decimals: 2, range: [6.5, 9] },
  do_sat: { key: 'do_sat', unit: '%', decimals: 1, range: [0, 200] },
  do_mgl: { key: 'do_mgl', unit: 'mg/L', decimals: 2, range: [0, 20] },
  turbidity: { key: 'turbidity', unit: 'NTU', decimals: 2, range: [0, 1000] },
  orp: { key: 'orp', unit: 'mV', decimals: 0, range: [-400, 600] },
}

/** QC flag bitmask carried by every sample. */
export const QC = {
  DRIFT: 1,
  SPIKE: 2,
  RANGE: 4,
  BACKFILL: 8,
  SETTLING: 16,
  ADAPTIVE: 32,
} as const

export type NodeStatus = 'online' | 'degraded' | 'offline'
export type RiskLevel = 'normal' | 'watch' | 'elevated' | 'high'
export type AlertKind = 'runoff' | 'organic' | 'freshwater' | 'upwelling' | 'drift' | 'comms' | 'battery'
export type AlertState = 'open' | 'acknowledged' | 'sampling' | 'confirmed' | 'refuted' | 'closed'
export type NearField = 'official_point' | 'stormwater' | 'hpp_outlet' | 'pumping_station'

export interface NodeHealth {
  batteryPct: number
  batteryV: number
  solarW: number
  rssi: number
  snr: number
  /** Packet delivery ratio over the last 24 h (0–1, incl. backfilled packets). */
  pdr24h: number
  intervalMin: number
  enclosureRh: number
  firmware: string
  hardware: string
}

export interface Maintenance {
  t: number
  kind: 'deploy' | 'cleaning' | 'calibration' | 'sensor_swap' | 'hw_upgrade'
  note: string
}

export interface Driver {
  param: Param | 'rain'
  /** Robust z-score against the local rolling baseline. */
  z: number
  delta: number
}

export interface RiskState {
  level: RiskLevel
  score: number
  drivers: Driver[]
  signature: AlertKind | null
}

export interface NodeInfo {
  id: string
  name: string
  place: string
  lat: number
  lon: number
  depthM: number
  deployedAt: number
  nearField: NearField[]
}

export interface DataQuality {
  expected: number
  received: number
  valid: number
  flagged: number
}

export interface NodeSummary extends NodeInfo {
  status: NodeStatus
  lastSeen: number | null
  latest: { t: number; values: Values; qc: number } | null
  delta24h: Values
  health: NodeHealth
  risk: RiskState
  quality24h: DataQuality
  daysSinceCleaning: number
  openAlerts: number
  spark: { t: number[] } & Record<Param, (number | null)[]>
}

export interface Alert {
  id: string
  nodeId: string
  kind: AlertKind
  severity: RiskLevel
  openedAt: number
  closedAt: number | null
  peakScore: number
  drivers: Driver[]
  rainMm24h: number
  state: AlertState
  ack: { at: number; by: string } | null
  verdict: {
    at: number
    by: string
    outcome: 'confirmed' | 'refuted'
    ecoli: number | null
    enterococci: number | null
    note: string
  } | null
  /** Hours between alert opening and the next routine/official lab result that would have shown the same. */
  leadTimeH: number | null
}

export type LabSource = 'reference' | 'orientation' | 'official'
export type Assessment = 'excellent' | 'good' | 'sufficient' | 'poor'

export interface LabSample {
  id: string
  nodeId: string
  t: number
  resultAt: number
  source: LabSource
  trigger: 'routine' | 'rain' | 'sensor_alert' | 'official'
  /** null while the result is pending. */
  ecoli: number | null
  enterococci: number | null
  /** Assessment against single-sample limits from Annex I of NN 73/08; null while pending. */
  assessment: Assessment | null
  sensor: Values | null
  alertId: string | null
}

export interface EnvNow {
  t: number
  airTemp: number
  windMs: number
  windDir: number
  windName: 'bura' | 'jugo' | 'maestral' | 'tramontana' | 'calm' | 'other'
  rain1h: number
  rain24h: number
  tideM: number
  tideTrend: 'rising' | 'falling'
  hppActive: boolean
}

export interface GridResponse {
  now: number
  site: { name: string; municipality: string; county: string; center: [number, number] }
  nodes: NodeSummary[]
  env: EnvNow
  officialSampling: { lastAt: number | null; lastAssessment: Assessment | null; nextDueAt: number | null; seasonActive: boolean }
  landmarks: { id: string; kind: NearField | 'official_point'; lat: number; lon: number }[]
  stats: {
    samples24h: number
    expected24h: number
    validPct24h: number
    openAlerts: number
    labPairs: number
    orientationAnalyses: number
  }
}

export type Resolution = 'raw' | '1h' | '3h' | '6h'

export interface SeriesResponse {
  node: NodeSummary
  from: number
  to: number
  resolution: Resolution
  t: number[]
  qc: number[]
  values: Record<Param, (number | null)[]>
  /** Only for aggregated resolutions. */
  min: Partial<Record<Param, (number | null)[]>>
  max: Partial<Record<Param, (number | null)[]>>
  risk: (number | null)[]
  baseline: Record<Param, { p10: number; p50: number; p90: number }>
  gaps: { from: number; to: number }[]
  rain: { from: number; to: number; mm: number }[]
  alerts: Alert[]
  lab: LabSample[]
  maintenance: Maintenance[]
  health: { batteryPct: (number | null)[]; rssi: (number | null)[]; snr: (number | null)[]; solarW: (number | null)[] }
  regimes: { from: number; to: number; regime: Exclude<Regime, 'marine'> }[]
}

export interface EnvSeriesResponse {
  from: number
  to: number
  t: number[]
  rainMm: number[]
  windMs: number[]
  windDir: number[]
  tideM: number[]
  airTemp: number[]
  hpp: number[]
}

export type Regime = 'marine' | 'freshwater' | 'runoff' | 'upwelling'

export interface TsResponse {
  nodeId: string
  points: { t: number; temp: number; salinity: number; regime: Regime }[]
  counts: Record<Regime, number>
}

export interface CompareResponse {
  param: Param
  from: number
  to: number
  resolution: Resolution
  t: number[]
  series: Record<string, (number | null)[]>
}

export interface ModelEvaluation {
  /** Water-quality alerts (runoff / organic) with a lab verdict. */
  evaluated: number
  confirmed: number
  refuted: number
  pending: number
  /** Routine or official samples above "good" with no alert within ±24 h. */
  missed: number
  precision: number | null
  recall: number | null
  medianLeadTimeH: number | null
  /** Confirmed episodes that no routine or official sample would have caught. */
  unseenByRoutine: number
  suppressed: { freshwater: number; upwelling: number }
}

export interface AlertsResponse {
  alerts: Alert[]
  evaluation: ModelEvaluation
}
