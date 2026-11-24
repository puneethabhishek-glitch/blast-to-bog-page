// Mulberry32. Half a step keeps uniforms strictly inside (0, 1) for inverse CDFs.
export function createRng(seed) {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Seed must be an integer.')
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let word = Math.imul(state ^ (state >>> 15), state | 1)
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61)
    return (((word ^ (word >>> 14)) >>> 0) + 0.5) / 4294967296
  }
}

export function uniform(rng, min = 0, max = 1) {
  return min + (max - min) * rng()
}

export function exponential(rng, mean) {
  return -mean * Math.log(rng())
}

// Precompute the log-space moments once per simulation configuration.
export function lognormalSampler(mean, cv) {
  if (cv === 0 || mean === 0) return () => mean
  const variance = Math.log1p(cv * cv)
  const scale = mean * Math.exp(-variance / 2)
  const sigma = Math.sqrt(variance)
  return rng => {
    const normal = Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng())
    return scale * Math.exp(sigma * normal)
  }
}

export function lognormal(rng, mean, cv) {
  return lognormalSampler(mean, cv)(rng)
}

export function nextPoissonArrival(rng, time, ratePerSecond) {
  return ratePerSecond === 0 ? Infinity : time + exponential(rng, 1 / ratePerSecond)
}
