import { runMonteCarlo } from './sim.js'

export const mapShifts = 60
export const mapShiftsFor = params => params.trafficModel === false ? mapShifts : 40
export const fillTimes = Array.from({ length: 10 }, (_, i) => 30 + i * 10)
export const hangUpRates = [6, 5, 4, 3, 2, 1, 0]
const counts = [1, 2, 3, 4, 5, 6]

export function fillFactorAtTime(time, anchors) {
  const groups = new Map()
  for (const { fillTime, fillFactor } of anchors) {
    const group = groups.get(fillTime) ?? []
    group.push(fillFactor)
    groups.set(fillTime, group)
  }
  const points = [...groups].sort(([a], [b]) => a - b).map(([x, values]) =>
    [x, values.reduce((sum, v) => sum + v, 0) / values.length])
  const upper = points.findIndex(([x]) => x >= time)
  if (upper < 0) return points.at(-1)[1]
  if (upper === 0) return points[0][1]
  const [x, y] = points[upper]
  const [lo, lowFactor] = points[upper - 1]
  return lowFactor + (time - lo) / (x - lo) * (y - lowFactor)
}

export function capacityAt(params, fillTime, hangUpsPer100, fillFactor = fillFactorAtTime(fillTime, params.table)) {
  const inputs = { ...params, fragmentationMode: 'direct', useOversize: false, fillTime, hangUpsPer100, fillFactor }
  const { results, limit, reason } = runMonteCarlo(inputs, counts, mapShiftsFor(params), 24)
  const rows = results.map(({ N, mean, operatorBusyShare }) => ({ N, mean, operatorBusyShare }))
  return { limit: limit ?? (rows.at(-1).mean > 0 ? '6+' : '—'), reason, rows }
}
