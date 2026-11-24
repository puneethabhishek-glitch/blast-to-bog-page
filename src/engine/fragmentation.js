function invalid(field, message) {
  throw Object.assign(new RangeError(message), { field })
}

/** Cunningham (1987) rough guide for bench blasts. All returned sizes are cm. */
export function kuzRam({ A, K_kg_per_m3: K, Q_kg: Q, RWS, B_m: B, S_m: S, D_mm: D, W_m: W, L_m: L, H_m: H }) {
  for (const [key, value] of Object.entries({ A, K_kg_per_m3: K, Q_kg: Q, RWS, B_m: B, S_m: S, D_mm: D, L_m: L, H_m: H })) {
    if (!Number.isFinite(value) || value <= 0) invalid(key, 'This Kuz-Ram input must be greater than zero.')
  }
  if (!Number.isFinite(W) || W < 0 || W >= B) invalid('W_m', 'Drilling deviation must be from zero to below the burden.')
  const x50 = A * K ** -0.8 * Q ** (1 / 6) * (115 / RWS) ** (19 / 30)
  const n = (2.2 - 14 * B / D) * Math.sqrt((1 + S / B) / 2) * (1 - W / B) * (L / H)
  if (n <= 0) invalid('D_mm', 'Burden and diameter must give a positive uniformity index.')
  return {
    x50, n,
    x80: x50 * (Math.log(5) / 0.693) ** (1 / n),
    percentRetained(sizeCm) {
      if (!(sizeCm >= 0)) invalid('oversizeSize', 'Size must be zero or greater in cm.')
      return 100 * Math.exp(-0.693 * (sizeCm / x50) ** n)
    }
  }
}

export function loadingFromX50(x50, table) {
  if (!Array.isArray(table) || !table.length) invalid('table', 'Enter at least one loading anchor.')
  for (const [i, row] of table.entries()) {
    for (const [key, name] of [['x50', 'Anchor size'], ['fillTime', 'Fill time'], ['fillFactor', 'Fill factor']]) {
      if (!Number.isFinite(row?.[key]) || row[key] <= 0) invalid('table.' + i + '.' + key, name + ' must be greater than zero.')
    }
    if (i && row.x50 <= table[i - 1].x50) invalid('table.' + i + '.x50', 'Anchor sizes must increase from fine to coarse.')
    if (!Number.isFinite(row.hangUpsPer100) || row.hangUpsPer100 < 0 || row.hangUpsPer100 > 100) {
      invalid('table.' + i + '.hangUpsPer100', 'Enter 0 to 100 hang-ups per 100 buckets.')
    }
  }
  if (!Number.isFinite(x50) || x50 < 0) invalid('x50', 'X50 must be a non-negative size in cm.')
  const right = table.findIndex(anchor => anchor.x50 >= x50)
  const high = right < 0 ? table.at(-1) : table[right]
  const low = right > 0 ? table[right - 1] : high
  const fraction = low === high ? 0 : (x50 - low.x50) / (high.x50 - low.x50)
  const between = key => low[key] + fraction * (high[key] - low[key])
  return {
    fillTime: between('fillTime'), fillFactor: between('fillFactor'), hangUpsPer100: between('hangUpsPer100'),
    outsideRange: x50 < table[0].x50 || x50 > table.at(-1).x50
  }
}
