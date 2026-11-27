// Nodes 0..B form the main drive. Node B+j is the brow off junction j.
// A longer crosscut at a nearer junction keeps every one-way haul equal to d.
export function roadLayout(distance, brows) {
  const nodes = [{ x: 0, y: 0 }]
  const edges = [null]
  const paths = []
  for (let j = 1; j <= brows; j++) {
    const x = distance * j / (brows + 1)
    nodes[j] = { x, y: 0 }
    nodes[brows + j] = { x, y: distance - x }
    edges[j] = { a: j - 1, b: j, length: x - nodes[j - 1].x }
    edges[brows + j] = { a: j, b: brows + j, length: distance - x }
  }
  for (let from = 0; from < nodes.length; from++) {
    paths[from] = []
    for (let to = 0; to < nodes.length; to++) {
      const steps = []
      let j = from
      if (from !== to) {
        if (j > brows) steps.push(j -= brows)
        const dest = to > brows ? to - brows : to
        while (j !== dest) steps.push(j += Math.sign(dest - j))
        if (to > brows) steps.push(to)
      }
      paths[from][to] = steps
    }
  }
  return { nodes, edges, paths, brows }
}

const EPS = 1e-8
// A junction (or the dump tip) holds one moving loader at a time. A loader asks
// for it this far before the junction and keeps it until this far past it.
export const JUNCTION_METRES = 20
// Time to pull from the junction into a passing bay. The junction stays held.
export const BAY_SECONDS = 3

// A loader releases each lane before it requests the next. Junction bays
// therefore never hold one lane while waiting to acquire another.
export function trafficController(layout, gap, api) {
  const { brows, edges, paths } = layout
  const lanes = edges.map(edge => edge && ({ a: edge.a, b: edge.b, length: edge.length, active: [], queue: [], last: 0, next: Infinity }))
  const berth = Array(brows).fill(null)
  // Node 0 is the dump tip. Nodes 1..brows are drive junctions.
  const holds = Array.from({ length: brows + 1 }, () => new Map())
  // Lanes with a loader waiting for each junction. Only these are woken.
  const waiters = Array.from({ length: brows + 1 }, () => new Set())
  // While the level is isolated no loader may start or continue a move.
  let halted = false

  function isJunction(node) { return node <= brows }
  // Time when the junction is next clear for l. Infinity means another loader
  // holds it until a road event releases it.
  function junctionClearAt(node, l, now) {
    let at = now
    for (const [other, until] of holds[node]) {
      if (until <= now + EPS) holds[node].delete(other)
      // A loader's own open hold lets it go on. Its own bay move must finish first.
      else if (other !== l || until !== Infinity) at = Math.max(at, until)
    }
    return at
  }
  function hold(node, l, until) {
    const before = holds[node].get(l)
    holds[node].set(l, until)
    // Waiters on an open hold re-check when it becomes timed.
    if (before === Infinity && Number.isFinite(until)) wakeJunction(node, until)
  }
  function release(node, l, now) {
    if (!holds[node].has(l)) return
    holds[node].delete(l)
    wakeJunction(node, now)
  }
  // Pulling into a passing bay keeps the junction for BAY_SECONDS.
  function toBay(l, now) {
    if (isJunction(l.node) && holds[l.node].get(l) === Infinity) hold(l.node, l, now + BAY_SECONDS)
  }
  function wakeJunction(node, time) {
    for (const lane of waiters[node]) wake(lane, time)
    waiters[node].clear()
  }
  // A loader may leave its node when it already holds that junction, or when
  // the junction is clear. Brow faces are not junctions.
  function canLeave(l, now) {
    return !isJunction(l.node) || junctionClearAt(l.node, l, now) <= now + EPS
  }
  function takeDeparture(l) {
    if (!isJunction(l.node)) return
    hold(l.node, l, Infinity)
    l.departing = l.node
  }
  function waitMode(l) {
    if (halted) return 'isolated'
    const to = l.toward
    return to > brows && !api.closed(to - brows - 1) && berth[to - brows - 1] !== null && berth[to - brows - 1] !== l ? 'waitingDrawpoint' : 'traffic'
  }

  function wake(lane, time) {
    if (time < lane.next) {
      lane.next = time
      api.schedule(time, 'lane', null, lane)
    }
  }
  function parked(l, mode) {
    api.state(l, mode)
    if (api.record) api.log('roadPosition', l, null, { node: l.node, mode, waitingFor: mode === 'traffic' || mode === 'waitingDrawpoint' ? l.toward : null })
  }
  function request(l, now) {
    if (l.step === l.path.length) {
      api.schedule(now, l.roadDone, l)
      return
    }
    const to = l.path[l.step]
    const lane = lanes[Math.max(to, l.node)]
    l.toward = to
    l.lane = lane
    // Most segments are uncontested. Enter immediately unless another event at
    // this timestamp could submit a competing request (loaded priority).
    const open = to <= brows || (!api.closed(to - brows - 1) && berth[to - brows - 1] === null)
    if (!halted && !lane.active.length && !lane.queue.length && open && !api.simultaneous?.(now) && canLeave(l, now)) {
      if (to > brows) berth[to - brows - 1] = l
      takeDeparture(l)
      lane.last = now
      lane.active.push(l)
      l.progress = 0
      l.velocity = -1
      tick(lane, now, true)
      return
    }
    lane.queue.push(l)
    toBay(l, now)
    parked(l, waitMode(l))
    wake(lane, now)
  }
  function start(l, to, speed, loaded, mode, done, now) {
    l.path = paths[l.node][to]
    l.step = 0
    l.roadSpeed = speed
    l.loaded = loaded
    l.moveMode = mode
    l.roadDone = done
    request(l, now)
  }
  function tick(lane, now, entering = false) {
    if (!entering) {
      if (now !== lane.next) return
      lane.next = Infinity
    }
    const dt = now - lane.last
    lane.last = now
    for (const l of lane.active) {
      if (l.velocity > 0) {
        l.progress += dt * l.velocity
        l.stopLeft -= dt
      }
      if (l.departing != null && (l.progress >= Math.min(JUNCTION_METRES, lane.length) - EPS)) {
        release(l.departing, l, now)
        l.departing = null
      }
    }
    for (let i = 0; i < lane.active.length;) {
      const l = lane.active[i]
      if (lane.length - l.progress <= EPS) {
        lane.active.splice(i, 1)
        if (l.node > brows) berth[l.node - brows - 1] = null
        l.node = l.toward
        l.step++
        l.lane = null
        if (l.step === l.path.length) {
          parked(l, l.moveMode)
          // Only the dump tip is a junction destination. The loader keeps it while tipping.
          if (isJunction(l.node) && l.node !== 0) toBay(l, now)
        }
        request(l, now)
      } else {
        if (l.stopLeft <= EPS && l.state !== 'stopped') {
          l.stopLeft = Infinity
          l.velocity = 0
          api.stop(l)
          if (api.record) movingFrame(l)
        }
        i++
      }
    }
    // A returning loader checks the brow from the junction, outside its crosscut.
    if (lane.b > brows && api.closed(lane.b - brows - 1)) {
      for (let i = 0; i < lane.queue.length; i++) {
        const l = lane.queue[i]
        if (l.toward !== lane.b) continue
        lane.queue.splice(i--, 1)
        l.lane = null
        api.schedule(now, l.roadDone, l)
      }
    }
    let next = Infinity
    if (lane.queue.length && !halted && !lane.active.some(l => l.state === 'stopped')) {
      // Keep FIFO within a priority class. A waiting loaded move drains an
      // opposing empty platoon before any more empties can enter.
      // A loaded loader that waits only for its junction to clear keeps its
      // right of way: nobody else enters until it has gone.
      const berthOpen = l => l.toward <= brows || berth[l.toward - brows - 1] === null
      const eligible = l => berthOpen(l) && canLeave(l, now)
      let i = lane.queue.findIndex(l => l.loaded && berthOpen(l))
      if (i >= 0 && !canLeave(lane.queue[i], now)) i = -1
      else if (i < 0) i = lane.queue.findIndex(eligible)
      if (i >= 0) {
        const l = lane.queue[i], tail = lane.active.at(-1)
        if (!tail || (tail.toward === l.toward && tail.progress + EPS >= gap)) {
          lane.queue.splice(i, 1)
          if (l.toward > brows) berth[l.toward - brows - 1] = l
          takeDeparture(l)
          l.progress = 0
          l.velocity = -1
          lane.active.push(l)
          if (lane.queue.length || lane.length <= EPS) next = now
        } else if (tail.toward === l.toward && tail.velocity > 0) {
          next = now + (gap - tail.progress) / tail.velocity
        }
      }
    }
    // Queued loaders that wait only for a junction re-check when it clears.
    for (const l of lane.queue) {
      if (isJunction(l.node)) {
        const at = junctionClearAt(l.node, l, now)
        if (at > now + EPS) {
          waiters[l.node].add(lane)
          if (Number.isFinite(at)) next = Math.min(next, at)
        }
      }
      const mode = waitMode(l)
      if (l.state !== mode && (l.state === 'traffic' || l.state === 'waitingDrawpoint' || l.state === 'isolated')) parked(l, mode)
    }
    let front
    for (const l of lane.active) {
      let speed = l.state === 'stopped' ? 0 : l.roadSpeed
      if (front && speed > front.velocity) {
        const clearance = front.progress - l.progress - gap
        if (clearance <= EPS) speed = front.velocity
        else next = Math.min(next, now + clearance / (speed - front.velocity))
      }
      // Ask for the junction ahead before entering it. Wait outside it if held.
      const ahead = l.toward, remaining = lane.length - l.progress
      if (isJunction(ahead) && !holds[ahead].has(l) && l.state !== 'stopped') {
        if (remaining <= JUNCTION_METRES + 1e-6) {
          const at = junctionClearAt(ahead, l, now)
          if (at <= now + EPS) hold(ahead, l, Infinity)
          else {
            speed = 0
            waiters[ahead].add(lane)
            if (Number.isFinite(at)) next = Math.min(next, at)
          }
        } else if (speed > 0) next = Math.min(next, now + (remaining - JUNCTION_METRES) / speed)
      }
      // A departing loader holds the junction behind it until it is clear. With
      // no speed change that is a known time, so no extra event is needed.
      if (l.departing != null && holds[l.departing].has(l)) {
        const left = Math.min(JUNCTION_METRES, lane.length) - l.progress
        hold(l.departing, l, speed > 0 ? now + Math.max(0, left) / speed : Infinity)
      }
      if (speed !== l.velocity) {
        l.velocity = speed
        if (l.state !== 'stopped') api.state(l, speed > 0 ? l.moveMode : 'traffic')
        if (api.record) movingFrame(l)
        // A change of tail speed also changes the earliest admission time.
        if (lane.queue.length) next = now
      }
      if (speed > 0) next = Math.min(next, now + (lane.length - l.progress) / speed, now + l.stopLeft)
      front = l
    }
    if (Number.isFinite(next)) wake(lane, next)
  }
  function movingFrame(l) {
    api.log('roadMotion', l, null, { fromNode: l.node, toNode: l.toward, metres: l.progress,
      speed: l.velocity, mode: l.state, loaded: l.loaded, waitingFor: l.state === 'traffic' ? l.toward : null })
  }
  return {
    start, tick, parked,
    occupy(l) { berth[l.point] = l },
    // Stop every moving loader where it is. Each stop then needs an operator reset.
    halt(now) {
      halted = true
      for (const lane of lanes) {
        if (!lane) continue
        for (const l of lane.active) if (l.state !== 'stopped') l.stopLeft = 0
        if (lane.active.length) wake(lane, now)
        for (const l of lane.queue) if (l.state !== 'isolated') parked(l, 'isolated')
      }
    },
    unhalt(now) {
      halted = false
      for (const lane of lanes) {
        if (!lane) continue
        for (const l of lane.queue) if (l.state === 'isolated') parked(l, waitMode(l))
        if (lane.queue.length || lane.active.length) wake(lane, now)
      }
    },
    refresh(point, now) { wake(lanes[brows + point + 1], now) },
    resume(l, now) {
      // A stopped vehicle has zero velocity. Apply elapsed time to its
      // neighbours in tick before calculating new speeds.
      api.state(l, l.moveMode)
      wake(l.lane, now)
    }
  }
}
