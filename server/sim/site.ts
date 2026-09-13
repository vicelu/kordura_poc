import type { NearField, NodeInfo } from '../../shared/types'

// Pilot site: Župski zaljev (Općina Župa dubrovačka). Positions are illustrative for the POC.

export const SITE = {
  name: 'Župski zaljev',
  municipality: 'Općina Župa dubrovačka',
  county: 'Dubrovačko-neretvanska županija',
  center: [42.6208, 18.2012] as [number, number],
}

export interface NodeProfile extends NodeInfo {
  /** Response coefficients of the micro-location to each forcing. */
  k: { fresh: number; runoff: number; organic: number; waves: number; upwelling: number; warm: number }
  radio: { rssi: number; snr: number }
  solarEff: number
  firmware: string
  hardware: string
}

const D = 86_400_000
const H = 3_600_000

export const NODES: NodeProfile[] = [
  {
    id: 'KRD-01',
    name: 'Srebreno',
    place: 'Plaža Srebreno',
    lat: 42.6219,
    lon: 18.1979,
    depthM: 3.5,
    deployedAt: -104 * D,
    nearField: ['official_point', 'stormwater'],
    k: { fresh: 0.22, runoff: 1.0, organic: 0.55, waves: 0.6, upwelling: 0.8, warm: 0.15 },
    radio: { rssi: -97, snr: 8.5 },
    solarEff: 1.0,
    firmware: '0.9.4',
    hardware: 'rev B (PCB v2, IP68 ASA)',
  },
  {
    id: 'KRD-02',
    name: 'Mlini',
    place: 'Ušće Zavrelja',
    lat: 42.6207,
    lon: 18.2079,
    depthM: 4.0,
    deployedAt: -68 * D,
    nearField: ['hpp_outlet'],
    k: { fresh: 1.0, runoff: 0.45, organic: 0.3, waves: 0.5, upwelling: 0.9, warm: 0.0 },
    radio: { rssi: -104, snr: 5.5 },
    solarEff: 0.93,
    firmware: '0.9.4',
    hardware: 'rev B (PCB v2, IP68 ASA)',
  },
  {
    id: 'KRD-03',
    name: 'Kupari',
    place: 'Plaža Kupari',
    lat: 42.6184,
    lon: 18.1932,
    depthM: 2.8,
    deployedAt: -68 * D,
    nearField: ['pumping_station'],
    k: { fresh: 0.07, runoff: 0.6, organic: 1.0, waves: 1.0, upwelling: 1.0, warm: 0.3 },
    radio: { rssi: -109, snr: 2.5 },
    solarEff: 0.78,
    firmware: '0.9.3',
    hardware: 'rev B (PCB v2, IP68 ASA)',
  },
]

export const LANDMARKS: { id: string; kind: NearField; lat: number; lon: number }[] = [
  { id: 'izor-srebreno', kind: 'official_point', lat: 42.6228, lon: 18.1983 },
  { id: 'stormwater-srebreno', kind: 'stormwater', lat: 42.6233, lon: 18.1968 },
  { id: 'hpp-zavrelje', kind: 'hpp_outlet', lat: 42.6223, lon: 18.2088 },
  { id: 'ps-kupari', kind: 'pumping_station', lat: 42.6197, lon: 18.1921 },
]

// Scenario, in offsets from the dataset anchor (≈ server start, rounded to the hour).

export const RAIN_EVENTS = [
  { at: -2.6 * D, durH: 3, mm: 5 },
  { at: -6.4 * D, durH: 9, mm: 38 },
  { at: -12.8 * D, durH: 4, mm: 9 },
  { at: -21.5 * D, durH: 7, mm: 22 },
  { at: -34.2 * D, durH: 2, mm: 6 },
  { at: -46.7 * D, durH: 6, mm: 27 },
  { at: -60.3 * D, durH: 3, mm: 4 },
  { at: -73.9 * D, durH: 5, mm: 15 },
  { at: -87.4 * D, durH: 8, mm: 31 },
  { at: -99.1 * D, durH: 4, mm: 11 },
]

export const WIND_EPISODES = [
  { kind: 'bura' as const, at: -9.5 * D, durH: 54, peak: 16 },
  { kind: 'bura' as const, at: -28 * D, durH: 40, peak: 12 },
  { kind: 'bura' as const, at: -57 * D, durH: 62, peak: 18 },
  { kind: 'bura' as const, at: -82 * D, durH: 30, peak: 11 },
  { kind: 'jugo' as const, at: -7.4 * D, durH: 30, peak: 11 },
  { kind: 'jugo' as const, at: -47.6 * D, durH: 24, peak: 9 },
  { kind: 'jugo' as const, at: -88.3 * D, durH: 26, peak: 10 },
]

/**
 * Hidden microbiological truth. The simulator uses it to shape faint sensor signatures and lab results;
 * the detector never sees it — that is the research question in miniature.
 */
export interface Episode {
  nodeId: string
  at: number
  durH: number
  /** Peak E. coli, cfu/100 mL. */
  peak: number
  /** How strongly the organic load shows up in DO/ORP/turbidity (0–1). */
  signature: number
  cause: 'rain' | 'dry'
}

export const DRY_EPISODES: Episode[] = [
  { nodeId: 'KRD-03', at: -0.45 * D, durH: 44, peak: 1400, signature: 0.9, cause: 'dry' },
  { nodeId: 'KRD-03', at: -31.2 * D, durH: 30, peak: 650, signature: 0.75, cause: 'dry' },
  // Faint dry-weather episode with almost no physico-chemical footprint: an honest false negative.
  { nodeId: 'KRD-01', at: -40.5 * D, durH: 20, peak: 380, signature: 0.12, cause: 'dry' },
]

/** Oxygen-demanding events without faecal bacteria (decomposing seagrass wrack after jugo): the model's false-positive trap. */
export const DECOY_EVENTS = [
  { nodeId: 'KRD-02', at: -24.3 * D, durH: 18, strength: 0.85 },
  { nodeId: 'KRD-01', at: -58.5 * D, durH: 14, strength: 0.8 },
]

export const RAIN_RESPONSE: Record<string, { minMm: number; weight: number }> = {
  'KRD-01': { minMm: 15, weight: 1.0 },
  'KRD-02': { minMm: 30, weight: 0.2 },
  'KRD-03': { minMm: 25, weight: 0.45 },
}

export const MAINTENANCE: Record<string, { at: number; kind: 'deploy' | 'cleaning' | 'calibration' | 'sensor_swap' | 'hw_upgrade'; note: string }[]> = {
  'KRD-01': [
    { at: -104 * D, kind: 'deploy', note: 'Integration prototype (gen 1) deployed next to the official sampling point' },
    { at: -104 * D + 2 * H, kind: 'calibration', note: 'Two-point pH, EC and turbidity calibration with certified standards' },
    { at: -83 * D, kind: 'cleaning', note: 'Biofouling removed, DO membrane inspected' },
    { at: -68 * D, kind: 'hw_upgrade', note: 'Upgraded to PCB v2 and 3D-printed IP68 enclosure' },
    { at: -68 * D + 3 * H, kind: 'calibration', note: 'Re-calibration after hardware upgrade' },
    { at: -47 * D, kind: 'cleaning', note: 'Routine cleaning' },
    { at: -27 * D, kind: 'cleaning', note: 'Routine cleaning' },
    { at: -6 * D, kind: 'cleaning', note: 'Routine cleaning after rain episode, sensor check OK' },
  ],
  'KRD-02': [
    { at: -68 * D, kind: 'deploy', note: 'Deployed in the near field of the Zavrelje outlet' },
    { at: -68 * D + 2 * H, kind: 'calibration', note: 'Two-point pH, EC and turbidity calibration with certified standards' },
    { at: -45 * D, kind: 'cleaning', note: 'Routine cleaning' },
    { at: -16.8 * D, kind: 'sensor_swap', note: 'pH electrode replaced (reference junction drift); node out of water 9 h' },
    { at: -11 * D, kind: 'cleaning', note: 'Routine cleaning' },
  ],
  'KRD-03': [
    { at: -68 * D, kind: 'deploy', note: 'Deployed in the near field of the Kupari pumping station' },
    { at: -68 * D + 2 * H, kind: 'calibration', note: 'Two-point pH, EC and turbidity calibration with certified standards' },
    { at: -44 * D, kind: 'cleaning', note: 'Routine cleaning' },
    { at: -19 * D, kind: 'cleaning', note: 'Routine cleaning; heavy fouling on turbidity window' },
  ],
}

export const OUTAGES: Record<string, { at: number; durH: number; cause: string }[]> = {
  'KRD-01': [],
  'KRD-02': [{ at: -16.8 * D, durH: 9, cause: 'maintenance' }],
  'KRD-03': [{ at: -37.6 * D, durH: 22, cause: 'battery' }],
}
