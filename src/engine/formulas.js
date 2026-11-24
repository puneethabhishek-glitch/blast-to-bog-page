export function deterministicBucketsPerHour(N, F, A, T = 0) {
  return 3600 * Math.min(N / (F + T + A), 1 / (F + T))
}

export function machineInterference(N, F, A) {
  // Each term adds one falling-factorial factor, avoiding large factorials.
  let term = 1
  let sum = 1
  for (let k = 1; k <= N; k++) {
    term *= (N - k + 1) * (F / A)
    sum += term
  }
  const P0 = 1 / sum
  const utilisation = 1 - P0
  return { P0, utilisation, bucketsPerHour: 3600 * utilisation / F }
}

export function maxUsefulLoaders(F, A) {
  return (F + A) / F
}
