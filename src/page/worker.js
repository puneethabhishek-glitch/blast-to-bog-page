import { comparisonDefaults, runMonteCarlo } from '../engine/index.js'

self.onmessage = ({ data: params }) => {
  try {
    self.postMessage({ result: runMonteCarlo(params, comparisonDefaults.counts, params.shifts, comparisonDefaults.seed) })
  } catch (error) {
    self.postMessage({ error: error.message })
  }
}
