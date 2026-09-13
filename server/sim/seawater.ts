// Seawater equations used both by the simulator and, in a real deployment, by the ingest pipeline.

const C35_15 = 42.914 // mS/cm, conductivity of standard seawater S=35, T=15 °C, p=0

/** PSS-78 practical salinity from conductivity (mS/cm) and temperature (°C, IPTS-68 ≈ ITS-90 here) at the surface. */
export function salinityFromConductivity(c: number, t: number): number {
  const R = c / C35_15
  const rt = 0.6766097 + 2.00564e-2 * t + 1.104259e-4 * t ** 2 - 6.9698e-7 * t ** 3 + 1.0031e-9 * t ** 4
  const Rt = Math.max(R / rt, 0)
  const s = Math.sqrt(Rt)
  const dS = ((t - 15) / (1 + 0.0162 * (t - 15))) * (0.0005 - 0.0056 * s - 0.0066 * Rt - 0.0375 * Rt * s + 0.0636 * Rt ** 2 - 0.0144 * Rt ** 2 * s)
  return 0.008 - 0.1692 * s + 25.3851 * Rt + 14.0941 * Rt * s - 7.0261 * Rt ** 2 + 2.7081 * Rt ** 2 * s + dS
}

/** Inverse of PSS-78 by bisection: conductivity (mS/cm) for a given salinity and temperature. */
export function conductivityFromSalinity(sal: number, t: number): number {
  let lo = 0
  let hi = 80
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (salinityFromConductivity(mid, t) < sal) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Oxygen solubility at 1 atm (Garcia & Gordon 1992, Benson & Krause fit), returned in mg/L. */
export function oxygenSolubilityMgL(t: number, sal: number): number {
  const Ts = Math.log((298.15 - t) / (273.15 + t))
  const lnC =
    5.80871 + 3.20291 * Ts + 4.17887 * Ts ** 2 + 5.10006 * Ts ** 3 - 9.86643e-2 * Ts ** 4 + 3.80369 * Ts ** 5 +
    sal * (-7.01577e-3 - 7.70028e-3 * Ts - 1.13864e-2 * Ts ** 2 - 9.51519e-3 * Ts ** 3) - 2.75915e-7 * sal ** 2
  const umolKg = Math.exp(lnC)
  const density = 1 + 0.0008 * sal // kg/L, adequate for surface water
  return umolKg * 0.0319988 * density
}
