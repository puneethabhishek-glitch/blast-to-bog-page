import { comparisonDefaults, simulateShift } from '../engine/index.js'
import { byId } from './controls.js'
import { mark, number, tonnes } from './charts.js'
import { afterTime, atTime, buildTimeline, queueTakeaway } from './timeline.js'
import { ICON, SLOTS, planGeometry, planPosition } from './road-position.js'


function clock(seconds) {
  const minutes = Math.floor(seconds / 60)
  return [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2, '0')).join(':')
}

function pulse(node) {
  if (!node.getAnimations().length) node.animate([{ fill: '#ec3440' }, { fill: '#ec3440', offset: .5 }, {}], 1000)
}

function createPlan(index, timeline, drawpoints, shifts, mean) {
  const root = document.createElement('article')
  root.className = 'plan'
  root.innerHTML = `<h3>Blast ${index + 1}</h3><svg class="level" viewBox="0 0 320 240" role="img" aria-label="Blast ${index + 1} level plan"></svg>
    <div class="plan-status"><p>Operator: <strong class="operator"></strong></p><p>Queue: <span class="queue"></span></p></div>
    <dl class="metrics"><div><dt>Shift clock</dt><dd class="clock"></dd></div><div><dt>Buckets dumped</dt><dd class="buckets"></dd></div><div><dt>Tonnes so far</dt><dd class="tonnes"></dd></div></dl>
    <div class="comparison-totals"><span>This shift <strong>${tonnes(timeline.tonnes)} t</strong></span><span>${number(shifts)}-shift mean <strong>${tonnes(mean)} t</strong></span></div>`
  const svg = root.querySelector('svg')
  const faces = [], crosses = []
  const g = timeline.layout && planGeometry(timeline.layout)
  if (g) {
    svg.setAttribute('viewBox', `0 0 ${g.width} ${Math.ceil(g.height)}`)
    const [dumpX, driveY] = g.px(0), endX = g.px(drawpoints)[0]
    // Widened passing areas at the dump and each junction. Roads draw over them.
    const upper = timeline.loaders.length > 2
    for (let j = 0; j <= drawpoints; j++) {
      const [x, y] = g.px(j)
      mark(svg, 'rect', { x: x - 30, y: y - (upper ? 25 : 9), width: 60, height: upper ? 50 : 34, rx: 9, fill: '#e4eae2', stroke: '#c3cfc1' })
    }
    let road = `M${dumpX} ${driveY} H${endX}`
    for (let j = 1; j <= drawpoints; j++) {
      const [x, y] = g.px(j), [, faceY] = g.px(drawpoints + j)
      road += ` M${x} ${y} V${faceY}`
    }
    for (const [stroke, width] of [['#a8b6a9', 15], ['#dce4da', 12]]) {
      mark(svg, 'path', { d: road, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round' })
    }
    mark(svg, 'path', { d: road, fill: 'none', stroke: '#abbba9', 'stroke-dasharray': '3 4' })
    mark(svg, 'rect', { x: dumpX - 14, y: driveY - 11, width: 28, height: 22, rx: 4, fill: '#d0b49b' })
    mark(svg, 'text', { x: dumpX, y: driveY - 30 }, 'Dump')
    for (let j = 1; j <= drawpoints; j++) {
      const [x, y] = g.px(drawpoints + j)
      mark(svg, 'text', { x, y: y - 17 }, 'Brow ' + j)
      faces.push(mark(svg, 'rect', { x: x - 14, y: y - 11, width: 28, height: 18, rx: 4, fill: '#d6e2d4', stroke: '#9aac9b' }))
      crosses.push(mark(svg, 'path', { d: `M${x + 14} ${y - 13} l9 9 m0 -9 l-9 9`, stroke: '#b2242c', 'stroke-width': 3.5, display: 'none' }))
    }
  } else {
    svg.setAttribute('viewBox', '0 0 320 70')
    svg.setAttribute('aria-label', 'Loader states with single lane traffic off')
    mark(svg, 'text', { x: 160, y: 17 }, 'Traffic off · loader states')
  }
  const machines = timeline.loaders.map((frames, id) => {
    const group = mark(svg, 'g', { class: 'machine' })
    const rect = mark(group, 'rect', { x: -ICON.width / 2, y: -ICON.height / 2, width: ICON.width, height: ICON.height, rx: 3 })
    mark(group, 'text', { y: 3.5 }, id + 1)
    const timer = mark(group, 'text', { class: 'stop-timer', y: -9 }, '')
    if (!timeline.layout) group.style.transform = `translate(${320 * (id + .5) / timeline.loaders.length}px, 50px)`
    return { id, frames, group, rect, timer }
  })
  const fields = Object.fromEntries(['clock', 'operator', 'queue', 'buckets', 'tonnes'].map(key => [key, root.querySelector('.' + key)]))
  let lastPanel, lastDump, lastClock
  function draw(time, stamp) {
    for (const machine of machines) {
      const frame = atTime(machine.frames, time)
      if (frame.state === 'stopped') {
        const s = Math.floor(Math.max(0, time - frame.stoppedAt))
        machine.timer.textContent = 'stopped ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
      } else if (machine.timer.textContent) machine.timer.textContent = ''
      if (machine.frame !== frame) {
        machine.frame = frame
        machine.rect.setAttribute('class', frame.state)
      }
      if (timeline.layout) {
        const [x, y] = planPosition(g, frame, time, machine.id)
        machine.group.style.transform = `translate(${x}px, ${y}px)`
      }
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
      if (faces[event.drawpoint]) pulse(faces[event.drawpoint])
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
      const brows = params[0].drawpoints, spare = brows - count
      // Only a fleet past the busy ceiling is called out. Crossing it means less spare time, not a queue that grows without end.
      const over = series.map((s, i) => s.limit != null && count > s.limit && ['operator', 'none'].includes(s.reason) ? i : null).filter(i => i !== null)
      takeaway.textContent += over.length ? ' This fleet exceeds the assumed workload ceiling for ' + (over.length === 2 ? 'both blasts' : 'Blast ' + (over[0] + 1)) +
        '. Watch how long a stopped loader waits when the operator is already filling another bucket.' : ''
      byId('replay-note').textContent = 'Schematic plan, not to a real level. Passing bays at every junction and at the dump are assumed. This replays one simulated shift. The chart numbers above come from ' + number(params[0].shifts) + ' shifts.' +
        (spare > 0 ? ' Each loader has its own home brow, so with ' + count + (count === 1 ? ' loader ' : ' loaders ') +
          (spare === 1 ? 'one brow is spare. It is' : spare + ' brows are spare. They are') + ' used only when another brow closes for secondary breaking.' : '')
      lastClock = null
      seek(0)
    }
  }
}
