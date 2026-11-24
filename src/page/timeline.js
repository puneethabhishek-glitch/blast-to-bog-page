// Equal-time events retain the engine's insertion order, including on a seek.
export function afterTime(events, t) {
  let lo = 0, hi = events.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (events[mid].time <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function atTime(events, time) {
  return events[afterTime(events, time) - 1]
}

// Point IDs come from the log. The dump is the only place without a drawpoint ID.
export const DUMP = -1

export function buildTimeline(shift) {
  const loaders = shift.loaders.map(() => [])
  const departures = []
  const queue = []
  let queuedJobSeconds = 0
  let previousTime = 0
  let operator = 'idle'
  let blockedPoints = 0
  const panels = [{ time: 0, operator, queue: 'empty', blockedPoints }]
  const dumps = [{ time: 0, buckets: 0, tonnes: 0 }]
  const hangUps = []

  for (const e of shift.eventLog) {
    const { type, time, drawpoint: point, loader: id } = e
    // The queue before this event occupied the entire preceding interval.
    queuedJobSeconds += queue.length * (time - previousTime)
    previousTime = time
    const loader = loaders[id]
    const previousOperator = operator
    const previousBlocks = blockedPoints
    let queueChanged = false
    function serve(job) {
      const i = queue.indexOf(job)
      if (i >= 0) {
        queue.splice(i, 1)
        queueChanged = true
      }
    }
    function parked(state) {
      loader.push({ time, state, from: point, to: point, until: time })
    }
    switch (type) {
      case 'handoverStarted': operator = 'shift handover'; break
      case 'dutyQueued': queue.push('other duties'); queueChanged = true; break
      case 'dutyStarted': serve('other duties'); operator = 'other duties'; break
      case 'dutyDone':
      case 'handoverDone': operator = 'idle'; break
      case 'queued':
        queue.push(id + 1)
        queueChanged = true
        parked('waitingOperator')
        break
      case 'waitingOperator':
      case 'waitingDrawpoint': parked(type); break
      case 'fillStarted':
        serve(id + 1)
        operator = 'filling loader ' + (id + 1)
        parked('filling')
        break
      case 'hangUp':
        serve(id + 1)
        operator = 'clearing a hang-up at DP' + (point + 1)
        hangUps.push(e)
        parked('blocked')
        break
      case 'rockbreaker':
        operator = 'idle'
        blockedPoints |= 1 << point
        break
      case 'unblocked': blockedPoints &= ~(1 << point); break
      case 'relocating':
        loader.push({ time, state: 'blocked', from: e.from, to: point, until: e.arrivesAt })
        break
      case 'departedLoaded':
        operator = 'idle'
        departures[id] = e
        loader.push({ time, state: 'driving', from: point, to: DUMP, until: e.dumpsAt })
        break
      case 'dumped':
        dumps.push(e)
        loader.push({ time, state: 'driving', from: DUMP, to: departures[id].returnPoint, until: departures[id].returnsAt })
        break
    }
    if (queueChanged || operator !== previousOperator || blockedPoints !== previousBlocks) {
      panels.push({ time, operator, blockedPoints, queue: queue.join(', ') || 'empty' })
    }
  }
  const duration = shift.eventLog.at(-1).time
  return { loaders, panels, dumps, hangUps, duration, tonnes: shift.tonnes, meanQueueLength: queuedJobSeconds / duration }
}

export function queueTakeaway(firstMean, secondMean, count) {
  const fleet = count + (count === 1 ? ' loader' : ' loaders')
  if (Math.min(firstMean, secondMean) >= 0.9 * Math.max(firstMean, secondMean)) {
    return 'Both operators have similar queues at ' + fleet + '.'
  }
  const longer = firstMean > secondMean ? 1 : 2
  return 'At ' + fleet + ', Blast ' + longer + ' has the longer operator queue on average during this shift.'
}
