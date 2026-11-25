import { createParams, validateParams, defaults } from './params.js'
import { createRng, exponential, lognormalSampler, nextPoissonArrival } from './rng.js'
import { autonomousTime, tonnesPerBucket } from './loader.js'
import { roadLayout, trafficController } from './road.js'
import { EventQueue } from './event-queue.js'

const emptyTimes = () => ({ filling: 0, driving: 0, waitingOperator: 0, waitingDrawpoint: 0, blocked: 0, traffic: 0, stopped: 0, idle: 0 })
const timeAccounts = Object.keys(emptyTimes())
const emptyOperator = () => ({ filling: 0, clearing: 0, otherDuties: 0, takeover: 0, resets: 0 })
const operatorAccounts = Object.keys(emptyOperator())

function sampler(distribution, mean, cv) {
  if (distribution === 'fixed') return () => mean
  if (distribution === 'exponential') return rng => exponential(rng, mean)
  if (distribution === 'lognormal') return lognormalSampler(mean, cv)
  throw new RangeError('Choose a fixed, exponential or lognormal distribution.')
}

function prepare(params, distribution) {
  const errors = validateParams(params).filter(issue => issue.severity === 'error')
  if (errors.length) throw new RangeError(errors.map(issue => issue.message).join(' '))
  const p = createParams(params)
  const trip = autonomousTime(p)
  const loadedAndDump = p.distance / (p.speedLoaded / 3.6) + p.dumpTime
  return {
    p, trip, layout: p.trafficModel ? roadLayout(p.distance, p.drawpoints) : null, end: p.shiftHours * 3600, dumpFraction: trip > 0 ? loadedAndDump / trip : 0,
    fillTime: sampler(distribution, p.fillTime, p.fillCV), tripTime: sampler(distribution, trip, p.tripCV),
    payload: tonnesPerBucket(p.bucketVolume, p.looseDensity, p.fillFactor, p.capacity).tonnes
  }
}

function checkCount(N) {
  if (!Number.isSafeInteger(N) || N < 1) throw new RangeError('Loader count must be a positive integer.')
}

function shift(config, N, seed, record) {
  const { p, end, payload, dumpFraction, fillTime, tripTime } = config
  const rng = createRng(seed)
  const events = new EventQueue()
  const eventLog = []
  const loaders = Array.from({ length: N }, (_, id) => ({
    id, home: id % p.drawpoints, point: id % p.drawpoints, state: 'idle', since: 0,
    buckets: 0, times: emptyTimes(), node: 0, lane: null, path: null, step: 0, toward: 0,
    roadSpeed: 0, velocity: 0, progress: 0, loaded: false, moveMode: 'driving', roadDone: '',
    stopLeft: Infinity, dwellDone: '', dwellLeft: 0, tripScale: 1, dumpsAt: 0, returnsAt: 0, dumped: false, returnPoint: 0
  }))
  const blocked = Array(p.drawpoints).fill(false)
  const free = Array(p.drawpoints).fill(true)
  let freeCount = p.drawpoints
  const jobs = [] // Loader objects and null duty jobs in FCFS order.
  const awaitingPoint = [] // New arrivals and stranded rockbreaker loaders, in arrival order.
  const operator = emptyOperator()
  const stopRate = p.autoStopsPerHour / 3600
  const dutySeconds = p.dutyBlockMinutes * 60
  const dutyRate = p.dutyShare / dutySeconds
  let busy = p.handoverMinutes > 0
  // One crib break at mid shift. The operator finishes the current task first.
  let cribDue = false
  let cribTaken = 0
  let now = 0
  let hangUps = 0
  let rockbreakers = 0
  let buckets = 0

  const B = p.drawpoints
  const road = p.trafficModel && trafficController(config.layout, p.minGapMetres, {
    state, schedule, log, record, simultaneous: time => events.items[0]?.time === time, stop: stopLoader, closed: point => blocked[point]
  })
  function stopLoader(l) {
    state(l, 'stopped')
    log('autoStop', l, null)
    if (p.resetPriority) {
      const firstFill = jobs.findIndex(job => job?.state !== 'stopped')
      jobs.splice(firstFill < 0 ? jobs.length : firstFill, 0, l)
    } else jobs.push(l)
  }
  function haul(l, destination, loaded, done) {
    const speed = (loaded ? p.speedLoaded : p.speedEmpty) / (3.6 * l.tripScale)
    road.start(l, destination, speed, loaded, 'driving', done, now)
  }
  function dwell(l, duration, done) {
    road.parked(l, 'driving')
    l.dwellDone = done
    if (l.stopLeft < duration) {
      l.dwellLeft = duration - l.stopLeft
      schedule(now + l.stopLeft, 'autoStop', l)
    } else {
      l.dwellLeft = 0
      l.stopLeft -= duration
      schedule(now + duration, done, l)
    }
  }
  function log(type, l = null, point = l?.point ?? null, details) {
    if (record) eventLog.push({ time: now, loader: l?.id ?? null, drawpoint: point, type, ...details })
  }
  function state(l, next) {
    if (road && l.state === next) return
    l.times[l.state] += now - l.since
    l.since = now
    l.state = next
  }
  function schedule(time, type, l = null, point = null) {
    if (time <= end) events.add(time, type, l, point)
  }
  function firstFree(preferred) {
    return free[preferred] ? preferred : free.indexOf(true)
  }
  function chooseBrow(preferred) {
    if (!blocked[preferred]) return preferred
    const open = free.indexOf(true)
    if (open >= 0) return open
    const available = blocked.indexOf(false)
    return available >= 0 ? available : preferred
  }
  function join(l) {
    if (road) {
      const target = chooseBrow(l.point)
      if (target !== l.point) return relocate(l, target)
      if (!blocked[l.point] && l.node <= B) {
        l.stopLeft = Infinity
        road.start(l, B + l.point + 1, p.speedEmpty / 3.6, false, 'driving', 'approached', now)
        return
      }
    }
    if (!freeCount) {
      state(l, 'waitingDrawpoint')
      awaitingPoint.push(l)
      log('waitingDrawpoint', l)
      return
    }
    if (!road) l.point = firstFree(l.point)
    state(l, 'waitingOperator')
    jobs.push(l)
    log('queued', l)
  }
  function relocate(l, target) {
    if (road) state(l, 'blocked')
    const from = l.point
    l.point = target
    if (road) {
      const dest = B + target + 1
      // Drive at normal empty speed. The rest of the relocation time is spent at the new brow.
      const speed = p.speedEmpty / 3.6
      if (record) log('relocating', l, target, { from, road: true })
      l.stopLeft = Infinity
      l.blockedAtDeparture = l.times.blocked + now - l.since
      road.start(l, dest, speed, false, 'blocked', 'relocationTravelDone', now)
      return
    }
    const arrivesAt = now + p.relocationMinutes * 60
    if (record) log('relocating', l, target, { from, arrivesAt })
    schedule(arrivesAt, 'relocated', l)
  }
  // Queued loaders stay at their brow while it is busy. Only a closure forces a move.
  function refreshBrowQueue() {
    for (let i = 0; i < jobs.length; i++) {
      const l = jobs[i]
      if (!l || l.state === 'stopped') continue
      if (blocked[l.point]) {
        jobs.splice(i--, 1)
        relocate(l, chooseBrow(l.point))
      } else if (l.state === 'waitingDrawpoint') {
        state(l, 'waitingOperator')
        log('waitingOperator', l)
      }
    }
  }
  function release(point) {
    free[point] = true
    freeCount++
    if (freeCount === 1) {
      if (road) refreshBrowQueue()
      else for (const l of jobs) if (l && l.state !== 'stopped') {
        l.point = point
        state(l, 'waitingOperator')
        log('waitingOperator', l)
      }
      for (const l of awaitingPoint) {
        if (!road && l.state === 'blocked' && point !== l.point) relocate(l, point)
        else join(l)
      }
      awaitingPoint.length = 0
    }
  }
  function startFill(l) {
    const duration = fillTime(rng)
    state(l, 'filling')
    operator.filling += Math.min(duration, end - now)
    log('fillStarted', l)
    schedule(now + duration, 'filled', l)
  }
  function takeControl(l, next) {
    state(l, 'filling')
    operator.takeover += Math.min(p.takeoverSeconds, end - now)
    log('takeoverStarted', l)
    schedule(now + p.takeoverSeconds, next, l)
  }
  function attempt(l) {
    if (p.hangUpsPer100 > 0 && rng() * 100 < p.hangUpsPer100) {
      const duration = p.clearMinutes * 60
      hangUps++
      state(l, 'blocked')
      operator.clearing += Math.min(duration, end - now)
      log('hangUp', l)
      schedule(now + duration, 'cleared', l)
    } else startFill(l)
  }
  // Only schedule uninterrupted travel. No stale dump/return can fire during a stop.
  function travel(l) {
    const stopAt = nextPoissonArrival(rng, now, stopRate)
    if (!l.dumped && l.dumpsAt <= stopAt) schedule(l.dumpsAt, 'dumped', l)
    if (stopAt < l.returnsAt) schedule(stopAt, 'autoStop', l)
    else schedule(l.returnsAt, 'returned', l)
  }
  function dispatch() {
    if (busy) return
    if (cribDue) {
      cribDue = false
      busy = true
      cribTaken = Math.min(p.cribMinutes * 60, end - now)
      log('cribStarted')
      schedule(now + p.cribMinutes * 60, 'cribDone')
      return
    }
    if (!jobs.length) return
    // Resets and other duties can proceed even when every brow is closed.
    const i = freeCount ? 0 : jobs.findIndex(job => job === null || job.state === 'stopped')
    if (i < 0) return
    const job = i === 0 ? jobs.shift() : jobs.splice(i, 1)[0]
    busy = true
    if (job === null) {
      operator.otherDuties += Math.min(dutySeconds, end - now)
      log('dutyStarted')
      schedule(now + dutySeconds, 'dutyDone')
      return
    }
    if (job.state === 'stopped') {
      const duration = p.autoStopResetMinutes * 60
      operator.resets += Math.min(duration, end - now)
      log('resetStarted', job, null)
      schedule(now + duration, 'resumed', job)
      return
    }
    if (!road) job.point = firstFree(job.point)
    free[job.point] = false
    freeCount--
    if (!freeCount) {
      for (const l of jobs) if (l && l.state !== 'stopped') {
        state(l, 'waitingDrawpoint')
        log('waitingDrawpoint', l)
      }
    }
    if (p.takeoverSeconds) takeControl(job, 'attempt')
    else attempt(job)
  }

  if (busy) {
    log('handoverStarted')
    schedule(p.handoverMinutes * 60, 'handoverDone')
  }
  for (const l of loaders) {
    if (road) {
      l.node = (l.id < B ? B : 0) + l.point + 1
      if (l.id < B) road.occupy(l)
      l.stopLeft = Infinity
      road.parked(l, 'idle')
    }
    join(l)
  }
  schedule(nextPoissonArrival(rng, 0, dutyRate), 'duty')
  if (p.cribMinutes > 0) schedule(end / 2, 'crib')
  dispatch()
  while (events.items.length) {
    const { time, type, loader: l, point } = events.pop()
    now = time
    switch (type) {
      case 'lane':
        road.tick(point, now)
        break
      case 'atDump':
        dwell(l, p.dumpTime * l.tripScale, 'dumped')
        break
      case 'atReturn':
        dwell(l, p.positioningTime * l.tripScale, 'returned')
        break
      case 'approached':
        join(l)
        break
      case 'crib':
        cribDue = true
        log('cribDue')
        break
      case 'handoverDone':
      case 'cribDone':
      case 'dutyDone':
        busy = false
        log(type)
        break
      case 'duty':
        jobs.push(null)
        log('dutyQueued')
        schedule(nextPoissonArrival(rng, now, dutyRate), 'duty')
        break
      case 'attempt':
        attempt(l)
        break
      case 'fillAfterClear':
        startFill(l)
        break
      case 'cleared':
        if (rng() >= p.rockbreakerShare) {
          log('cleared', l)
          if (p.takeoverSeconds) takeControl(l, 'fillAfterClear')
          else startFill(l) // Retain the operator, with no new hang-up draw.
          break
        }
        rockbreakers++
        busy = false
        blocked[l.point] = true
        log('rockbreaker', l)
        if (road) road.refresh(l.point, now)
        schedule(now + p.blockMinutes * 60, 'unblocked', null, l.point)
        if (freeCount) {
          relocate(l, firstFree(l.home))
          if (road) refreshBrowQueue()
        } else {
          awaitingPoint.push(l) // Stay blocked until a point opens.
          log('awaitingUnblock', l)
        }
        break
      case 'unblocked':
        blocked[point] = false
        log('unblocked', null, point)
        release(point)
        if (road) road.refresh(point, now)
        break
      case 'relocationTravelDone': {
        // A second closure can cut off the last crosscut. Finish the configured
        // relocation work in the bay. Time queueing for lanes remains traffic.
        road.parked(l, 'blocked')
        const work = l.times.blocked + now - l.since - l.blockedAtDeparture
        schedule(now + Math.max(0, p.relocationMinutes * 60 - work), 'relocated', l)
        break
      }
      case 'relocated':
        log('relocated', l)
        join(l)
        break
      case 'filled': {
        busy = false
        state(l, 'driving')
        const duration = tripTime(rng)
        const dumpsAt = now + duration * dumpFraction
        const returnsAt = now + duration
        if (record) {
          // Provisional destination for a trip clipped before its dump. Once this
          // loader departs, the single operator holds no brow.
          const returnPoint = road && blocked[l.home] ? blocked.indexOf(false) : l.home
          log('departedLoaded', l, l.point, { dumpsAt, returnsAt, returnPoint })
        }
        l.dumpsAt = dumpsAt
        l.returnsAt = returnsAt
        l.dumped = false
        if (road) {
          l.tripScale = config.trip > 0 ? duration / config.trip : 1
          l.stopLeft = nextPoissonArrival(rng, 0, stopRate)
          haul(l, 0, true, 'atDump')
        } else travel(l)
        release(l.point)
        break
      }
      case 'autoStop':
        stopLoader(l)
        break
      case 'resumed': {
        busy = false
        if (road) {
          l.stopLeft = nextPoissonArrival(rng, 0, stopRate)
          log('resumed', l, null)
          if (l.lane) road.resume(l, now)
          else dwell(l, l.dwellLeft, l.dwellDone)
          break
        }
        const delay = now - l.since
        if (!l.dumped) l.dumpsAt += delay
        l.returnsAt += delay
        state(l, 'driving')
        if (record) log('resumed', l, null, { dumpsAt: l.dumpsAt, returnsAt: l.returnsAt })
        travel(l)
        break
      }
      case 'dumped':
        l.dumped = true
        l.returnPoint = road ? chooseBrow(l.home) : l.home
        l.buckets++
        buckets++
        if (record) log('dumped', l, l.point, road ? { buckets, tonnes: buckets * payload, returnPoint: l.returnPoint } : { buckets, tonnes: buckets * payload })
        if (road) haul(l, B + l.returnPoint + 1, false, 'atReturn')
        break
      case 'returned':
        l.point = l.returnPoint
        log('returned', l)
        join(l)
        break
    }
    dispatch()
  }
  now = end
  log('shiftEnded')
  const totals = loaders.map(l => {
    l.times[l.state] += end - l.since
    return { id: l.id, buckets: l.buckets, tonnes: l.buckets * payload, ...l.times }
  })
  return { ...(road && record ? { layout: config.layout } : {}), ...(p.resetPriority ? { resetPriority: true } : {}), loaders: totals, operator, workingSeconds: end - Math.min(end, p.handoverMinutes * 60) - cribTaken, hangUps, rockbreakers, buckets, tonnes: buckets * payload, eventLog }
}

/** Replay logs use zero-based IDs and seconds since shift start. */
export function simulateShift(params, N, seed, options = {}) {
  checkCount(N)
  return shift(prepare(params, options.distribution ?? 'lognormal'), N, seed, options.eventLog !== false)
}

function percentile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  return sorted[lower] + (index - lower) * (sorted[Math.ceil(index)] - sorted[lower])
}

export function runMonteCarlo(params, Nlist, shifts = params?.shifts ?? defaults.shifts.value, seed = 0) {
  if (!Number.isSafeInteger(shifts) || shifts < 1) throw new RangeError('Shifts must be a positive integer.')
  const config = prepare(params, 'lognormal')
  const counts = [...new Set(Nlist)].sort((a, b) => a - b)
  const seedRng = createRng(seed)
  const seeds = Array.from({ length: shifts }, () => Math.floor(seedRng() * 4294967296))
  const results = counts.map(N => {
    checkCount(N)
    let sum = 0
    let working = 0
    const operatorShares = emptyOperator()
    const tonnes = []
    const meanTime = emptyTimes()
    for (const shiftSeed of seeds) {
      const result = shift(config, N, shiftSeed, false)
      tonnes.push(result.tonnes)
      sum += result.tonnes
      working += result.workingSeconds
      for (const key of operatorAccounts) operatorShares[key] += result.operator[key]
      for (const l of result.loaders) {
        for (const key of timeAccounts) meanTime[key] += l[key]
      }
    }
    tonnes.sort((a, b) => a - b)
    for (const key of timeAccounts) meanTime[key] /= shifts * N
    // Shares of working time: the shift less handover and crib.
    for (const key of operatorAccounts) operatorShares[key] /= working || shifts * config.end
    const operatorBusyShare = operatorAccounts.reduce((sum, key) => sum + operatorShares[key], 0)
    return { N, mean: sum / shifts, p10: percentile(tonnes, 0.1), p50: percentile(tonnes, 0.5),
      p90: percentile(tonnes, 0.9), meanTime, operatorShares, operatorBusyShare }
  })
  const knee = results.find((row, i) => {
    const next = results[i + 1]
    return next?.N === row.N + 1 && row.mean > 0 && next.mean - row.mean < 0.1 * row.mean
  })?.N ?? null
  return { results, knee, ...operatorLimit(results, knee, config.p) }
}

/**
 * The operator's loader limit is the largest fleet that keeps the operator at or
 * below the busy ceiling, unless an extra loader already adds under 10% before that.
 * The reason says what sets the limit: the operator, the open brows, or little gain.
 */
export function operatorLimit(results, knee, p) {
  let within = 0
  for (let i = 0; i < results.length; i++) {
    if (i && results[i].N !== results[i - 1].N + 1) break
    if (results[i].operatorBusyShare > p.operatorCeiling + 1e-9) break
    within = results[i].N
  }
  if (!results.length || results.every(r => !(r.mean > 0))) return { limit: null, reason: null }
  const cap = within || results[0].N
  const limit = knee != null ? Math.min(knee, cap) : cap
  const next = results.find(r => r.N === limit + 1)
  if (!next) return { limit: null, reason: null }
  if (next.operatorBusyShare > p.operatorCeiling + 1e-9) return { limit, reason: 'operator' }
  return { limit, reason: limit >= p.drawpoints ? 'brows' : 'gain' }
}
