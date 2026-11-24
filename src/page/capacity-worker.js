import { capacityAt } from '../engine/capacity.js'

self.onmessage = ({ data: { params, jobs } }) => {
  try {
    for (const job of jobs) {
      const result = capacityAt(params, job.fillTime, job.hangUpsPer100, job.fillFactor)
      self.postMessage({ key: job.key, result })
    }
  } catch (error) {
    self.postMessage({ error: error.message })
  }
}
