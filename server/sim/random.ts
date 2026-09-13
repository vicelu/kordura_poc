// Deterministic pseudo-randomness so every restart on the same day yields the same dataset.

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type Rng = () => number

export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** First-order autoregressive noise: smooth, mean-reverting wander. */
export function ar1(rng: Rng, n: number, phi: number, sigma: number): Float32Array {
  const out = new Float32Array(n)
  let x = 0
  const innov = sigma * Math.sqrt(1 - phi * phi)
  for (let i = 0; i < n; i++) {
    x = phi * x + innov * gaussian(rng)
    out[i] = x
  }
  return out
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Smooth 0→1→0 pulse with rise and exponential decay. */
export function pulse(dtH: number, riseH: number, decayH: number): number {
  if (dtH < 0) return 0
  if (dtH < riseH) return Math.sin((dtH / riseH) * (Math.PI / 2)) ** 2
  return Math.exp(-(dtH - riseH) / decayH)
}
