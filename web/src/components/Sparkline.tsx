/** Tiny inline SVG trend line; decorative — the value it sits under carries the meaning. */
export function Sparkline({ values, color = 'var(--data-line)', band }: { values: (number | null)[]; color?: string; band?: [number, number] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null)
  if (pts.length < 2) return <svg className="spark" aria-hidden="true" />
  let lo = Math.min(...pts.map((p) => p[1]))
  let hi = Math.max(...pts.map((p) => p[1]))
  if (band) {
    lo = Math.min(lo, band[0])
    hi = Math.max(hi, band[1])
  }
  const pad = (hi - lo) * 0.12 || 1
  lo -= pad
  hi += pad
  const W = 100
  const Hh = 26
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => Hh - ((v - lo) / (hi - lo)) * Hh
  let d = ''
  let prev = -2
  for (const [i, v] of pts) {
    d += `${i === prev + 1 ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`
    prev = i
  }
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" aria-hidden="true">
      {band && <rect x="0" width={W} y={y(band[1])} height={Math.max(0.5, y(band[0]) - y(band[1]))} fill="var(--chart-band)" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
