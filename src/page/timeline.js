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

export function routeFraction(frame, time) {
  const start = frame.fraction ?? 0
  if (frame.state === 'stopped') return start
  const progress = frame.until > frame.time ? Math.min(1, Math.max(0, (time - frame.time) / (frame.until - frame.time))) : 1
  return start + (1 - start) * progress
}

export function buildTimeline(shift) {
  const loaders = shift.loaders.map(() => [])
  const departures = []
  const traffic = Boolean(shift.layout)
  const motion = [], stoppedAt = [], bay = [], exit = []
  let service = null
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
    function parked(state, atFace = false) {
      const frame = { time, state, from: point, to: point, until: time }
      if (atFace) frame.service = service ??= { start: time, end: Infinity }
      if (traffic) {
        Object.assign(frame, { motion: motion[id], stoppedAt: stoppedAt[id] })
        const m = motion[id]
        if (m.from === m.to) {
          // A waiting loader pulls into a passing bay once, then stays there.
          const waiting = m.from >= 1 && m.from <= shift.layout.brows ||
            m.from === 0 && !(state === 'driving' || state === 'stopped')
          if (waiting) bay[id] = bay[id]?.node === m.from ? bay[id] : { node: m.from, since: loader.length ? time : -Infinity }
          else bay[id] = null
          if (bay[id]) frame.bay = bay[id]
        } else {
          // Moving frames on the lane that leaves a bay keep the bay exit path.
          if (bay[id]?.node === m.from && m.metres === 0) exit[id] = { from: m.from, to: m.to }
          else if (exit[id] && (exit[id].from !== m.from || exit[id].to !== m.to)) exit[id] = null
          bay[id] = null
          if (exit[id]) frame.fromBay = true
        }
      }
      loader.push(frame)
    }
    function leaveFace() {
      if (service) service.end = time
      service = null
    }
    switch (type) {
      case 'roadPosition':
        motion[id] = { from: e.node, to: e.node, at: time, metres: 0, speed: 0, waitingFor: e.waitingFor }
        parked(e.mode)
        break
      case 'roadMotion':
        motion[id] = { from: e.fromNode, to: e.toNode, at: time, metres: e.metres, speed: e.speed, waitingFor: e.waitingFor }
        parked(e.mode)
        break
      case 'handoverStarted': operator = 'shift handover'; break
      case 'cribStarted': operator = 'crib break'; break
      case 'dutyQueued': queue.push('other duties'); queueChanged = true; break
      case 'dutyStarted': serve('other duties'); operator = 'other duties'; break
      case 'dutyDone':
      case 'cribDone':
      case 'handoverDone': operator = 'idle'; break
      case 'queued':
        queue.push(id + 1)
        queueChanged = true
        parked('waitingOperator')
        break
      case 'waitingOperator':
      case 'waitingDrawpoint': parked(type); break
      case 'autoStop': {
        stoppedAt[id] = time
        const travel = loader.at(-1)
        loader.push({ ...travel, time, state: 'stopped', stoppedAt: time, fraction: routeFraction(travel, time) })
        const job = 'reset loader ' + (id + 1)
        const i = shift.resetPriority ? queue.findIndex(j => !String(j).startsWith('reset loader ')) : -1
        queue.splice(i < 0 ? queue.length : i, 0, job)
        queueChanged = true
        break
      }
      case 'resetStarted':
        serve('reset loader ' + (id + 1))
        operator = 'resetting loader ' + (id + 1)
        break
      case 'resumed': {
        stoppedAt[id] = undefined
        operator = 'idle'
        if (traffic) break
        const frozen = loader.at(-1)
        departures[id] = { ...departures[id], returnsAt: e.returnsAt }
        loader.push({ ...frozen, time, state: 'driving', until: frozen.to === DUMP ? e.dumpsAt : e.returnsAt })
        operator = 'idle'
        break
      }
      case 'takeoverStarted':
        serve(id + 1)
        operator = 'taking control of loader ' + (id + 1)
        parked('filling', true)
        break
      case 'fillStarted':
        serve(id + 1)
        operator = 'filling loader ' + (id + 1)
        parked('filling', true)
        break
      case 'hangUp':
        serve(id + 1)
        operator = 'clearing a hang-up at Brow ' + (point + 1)
        hangUps.push(e)
        parked('blocked', true)
        break
      case 'rockbreaker':
        leaveFace()
        operator = 'idle'
        blockedPoints |= 1 << point
        break
      case 'unblocked': blockedPoints &= ~(1 << point); break
      case 'relocating':
        serve(id + 1)
        if (traffic) break
        loader.push({ time, state: 'blocked', from: e.from, to: point, until: e.arrivesAt })
        break
      case 'departedLoaded':
        leaveFace()
        operator = 'idle'
        if (traffic) break
        departures[id] = e
        loader.push({ time, state: 'driving', from: point, to: DUMP, until: e.dumpsAt })
        break
      case 'dumped':
        dumps.push(e)
        if (traffic) break
        loader.push({ time, state: 'driving', from: DUMP, to: e.returnPoint ?? departures[id].returnPoint, until: departures[id].returnsAt })
        break
    }
    if (queueChanged || operator !== previousOperator || blockedPoints !== previousBlocks) {
      panels.push({ time, operator, blockedPoints, queue: queue.join(', ') || 'empty' })
    }
  }
  const duration = shift.eventLog.at(-1).time
  return { layout: shift.layout, loaders, panels, dumps, hangUps, duration, tonnes: shift.tonnes, meanQueueLength: queuedJobSeconds / duration }
}

export function queueTakeaway(firstMean, secondMean, count) {
  const fleet = count + (count === 1 ? ' loader' : ' loaders')
  if (Math.min(firstMean, secondMean) >= 0.9 * Math.max(firstMean, secondMean)) {
    return 'Both operators have similar queues at ' + fleet + '.'
  }
  const longer = firstMean > secondMean ? 1 : 2
  return 'At ' + fleet + ', Blast ' + longer + ' has the longer operator queue on average during this shift.'
}
