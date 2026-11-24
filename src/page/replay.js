import { comparisonDefaults, simulateShift } from '../engine/index.js'
import { byId } from './controls.js'
import { mark, number, tonnes } from './charts.js'
import { afterTime, atTime, buildTimeline, DUMP, queueTakeaway } from './timeline.js'

function clock(seconds) {
  const minutes = Math.floor(seconds / 60)
  return [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, '0')).join(':')
}

const driveY = 101
const berthY = 49
const dumpX = 24

// Schematic distances: travel at constant speed along each orthogonal route.
function route(from, to, points) {
  const start = from === DUMP ? [dumpX, driveY] : [points[from], berthY]
  const end = to === DUMP ? [dumpX, driveY] : [points[to], berthY]
  const corners = [start, [start[0], driveY], [end[0], driveY], end]
  const legs = []
  let length = 0
  for (let i = 1; i < corners.length; i++) {
    const [x, y] = corners[i - 1]
    const dx = corners[i][0] - x, dy = corners[i][1] - y
    const size = Math.abs(dx) + Math.abs(dy)
    if (size) legs.push({ x, y, dx, dy, size, start: length })
    length += size
  }
  return { start, legs, length: from === to ? 0 : length }
}

function move(machine, path, fraction) {
  let [x, y] = path.start
  if (path.length) {
    const distance = path.length * Math.min(1, Math.max(0, fraction))
    const leg = path.legs.find(s => distance <= s.start + s.size) ?? path.legs.at(-1)
    const part = (distance - leg.start) / leg.size
    x = leg.x + leg.dx * part
    y = leg.y + leg.dy * part
  }
  machine.group.style.transform = `translate(${x + machine.dx}px, ${y + machine.dy}px)`
}

function pulse(node) {
  if (!node.getAnimations().length) node.animate([{ fill: '#ec3440' }, { fill: '#ec3440', offset: .5 }, {}], 1000)
}

function createPlan(index, timeline, drawpoints, shifts, mean) {
  const root = document.createElement('article')
  root.className = 'plan'
  root.innerHTML = `<h3>Blast ${index + 1}</h3><svg class="level" viewBox="0 0 320 132" role="img" aria-label="Blast ${index + 1} level plan"></svg>
    <div class="plan-status"><p>Operator: <strong class="operator"></strong></p><p>Queue: <span class="queue"></span></p></div>
    <dl class="metrics"><div><dt>Shift clock</dt><dd class="clock"></dd></div><div><dt>Buckets dumped</dt><dd class="buckets"></dd></div><div><dt>Tonnes so far</dt><dd class="tonnes"></dd></div></dl>
    <div class="comparison-totals"><span>This shift <strong>${tonnes(timeline.tonnes)} t</strong></span><span>${number(shifts)}-shift mean <strong>${tonnes(mean)} t</strong></span></div>`
  const svg = root.querySelector('svg')
  const points = Array.from({ length: drawpoints }, (_, i) => 86 + i * 208 / (drawpoints - 1))
  const road = `M${dumpX} ${driveY} H298 ` + points.map(x => `M${x} ${driveY} V${berthY}`).join(' ')
  for (const [stroke, width] of [['#a8b6a9', 24], ['#dce4da', 21]]) {
    mark(svg, 'path', { d: road, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round' })
  }
  mark(svg, 'path', { d: road, fill: 'none', stroke: '#abbba9', 'stroke-dasharray': '3 4' })
  mark(svg, 'rect', { x: dumpX - 18, y: driveY - 15, width: 36, height: 30, rx: 4, fill: '#d0b49b' })
  mark(svg, 'text', { x: dumpX, y: 81 }, 'Dump')
  const faces = [], crosses = []
  for (const [i, x] of points.entries()) {
    mark(svg, 'text', { x, y: 20 }, 'DP' + (i + 1))
    faces.push(mark(svg, 'rect', { x: x - 19, y: berthY - 16, width: 38, height: 32, rx: 5, fill: '#d6e2d4', stroke: '#9aac9b' }))
    crosses.push(mark(svg, 'path', { d: `M${x-5} 68 l10 10 m0 -10 l-10 10`, stroke: '#b2242c', 'stroke-width': 4, display: 'none' }))
  }
  const paths = new Map()
  const machines = timeline.loaders.map((frames, id) => {
    const group = mark(svg, 'g', { class: 'machine' })
    const rect = mark(group, 'rect', { x: -8.5, y: -7, width: 17, height: 14, rx: 4 })
    mark(group, 'text', { y: 4 }, id + 1)
    return { frames, group, rect, dx: (id % 2 ? 9 : -9), dy: (id < 2 ? -7 : 7) }
  })
  const fields = Object.fromEntries(['clock', 'operator', 'queue', 'buckets', 'tonnes'].map(key => [key, root.querySelector('.' + key)]))
  let lastPanel, lastDump, lastClock
  function draw(time, stamp) {
    for (const machine of machines) {
      const frame = atTime(machine.frames, time)
      if (machine.frame !== frame) {
        machine.frame = frame
        machine.rect.setAttribute('class', frame.state)
        const key = frame.from + '/' + frame.to
        if (!paths.has(key)) paths.set(key, route(frame.from, frame.to, points))
        machine.path = paths.get(key)
        move(machine, machine.path, 0)
      }
      if (machine.path.length) move(machine, machine.path, frame.until > frame.time ? (time - frame.time) / (frame.until - frame.time) : 1)
    }
    const panel = atTime(timeline.panels, time)
    if (panel !== lastPanel) {
      fields.operator.textContent = panel.operator
      fields.queue.textContent = panel.queue
      crosses.forEach((cross, i) => cross.setAttribute('display', (panel.blockedPoints & (1 << i)) ? 'inline' : 'none'))
      lastPanel = panel
    }
    const dump = atTime(timeline.dumps, time)
    if (dump !== lastDump) {
      fields.buckets.textContent = number(dump.buckets)
      fields.tonnes.textContent = number(dump.tonnes)
      lastDump = dump
    }
    if (lastClock !== stamp) fields.clock.textContent = lastClock = stamp
  }
  function flash(time, previous) {
    const end = afterTime(timeline.hangUps, time)
    for (let j = end - 1; j >= 0; j--) {
      const event = timeline.hangUps[j]
      if (previous == null ? event.time !== time : event.time <= previous) break
      pulse(machines[event.loader].rect)
      pulse(faces[event.drawpoint])
    }
  }
  return { root, draw, flash, timeline }
}

export function setupReplay() {
  const section = byId('replay'), slider = byId('seek'), play = byId('play'), jump = byId('jump')
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let playing = !motion.matches, visible = false, frameId = 0, previousStamp = null
  let plans = [], end = 0, time = 0, speed = Number(byId('speed').value)
  let hangUps = [], nextHangUp = 0, lastClock
  function paint(previous, flash = true) {
    const stamp = clock(time)
    for (const plan of plans) {
      plan.draw(time, stamp)
      if (flash && !motion.matches) plan.flash(time, previous)
    }
    slider.value = time
    if (stamp !== lastClock) {
      byId('seek-clock').textContent = stamp + ' / ' + clock(end)
      slider.setAttribute('aria-valuetext', stamp)
      lastClock = stamp
    }
    nextHangUp = afterTime(hangUps, time)
    const exhausted = nextHangUp === hangUps.length
    if (jump.disabled !== exhausted) jump.disabled = exhausted
  }
  function tick(stamp) {
    frameId = 0
    const previous = time
    if (previousStamp != null) time = Math.min(end, time + (stamp - previousStamp) * speed / 1000)
    previousStamp = stamp
    paint(previous)
    if (time >= end) {
      playing = false
      sync()
    } else frameId = requestAnimationFrame(tick)
  }
  function sync() {
    play.textContent = playing ? 'Pause' : 'Play'
    if (playing && visible && !document.hidden && plans.length) {
      if (!frameId) frameId = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(frameId)
      frameId = 0
      previousStamp = null
      if (!visible || document.hidden) section.getAnimations({ subtree: true }).forEach(a => a.cancel())
    }
  }
  function seek(value) {
    time = Math.min(end, Math.max(0, value))
    previousStamp = null
    if (time === end) playing = false
    section.getAnimations({ subtree: true }).forEach(a => a.cancel())
    paint(null)
    sync()
  }
  slider.oninput = () => seek(slider.valueAsNumber)
  play.onclick = () => {
    playing = !playing
    if (playing && time >= end) seek(0)
    sync()
  }
  byId('speed').oninput = event => { speed = Number(event.target.value); previousStamp = null }
  jump.onclick = () => { if (nextHangUp < hangUps.length) seek(hangUps[nextHangUp].time) }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() }).observe(section)
  document.addEventListener('visibilitychange', sync)
  motion.addEventListener('change', () => {
    if (motion.matches) {
      playing = false
      section.getAnimations({ subtree: true }).forEach(a => a.cancel())
    }
    sync()
  })
  return {
    rebuild(params, series) {
      const count = Number(byId('replay-replayCount').value)
      plans = params.map((p, i) => {
        const timeline = buildTimeline(simulateShift(p, count, comparisonDefaults.seed))
        return createPlan(i, timeline, p.drawpoints, p.shifts, series[i].results.find(r => r.N === count).mean)
      })
      byId('plans').replaceChildren(...plans.map(p => p.root))
      const takeaway = byId('queue-takeaway')
      takeaway.textContent = queueTakeaway(plans[0].timeline.meanQueueLength, plans[1].timeline.meanQueueLength, count)
      takeaway.hidden = false
      end = plans[0].timeline.duration
      slider.max = end
      hangUps = plans.flatMap(p => p.timeline.hangUps).sort((a, b) => a.time - b.time)
      byId('transport').disabled = false
      byId('replay-note').textContent = 'This replays one simulated shift. The chart numbers above come from ' + number(params[0].shifts) + ' shifts.'
      lastClock = null
      seek(0)
    }
  }
}
