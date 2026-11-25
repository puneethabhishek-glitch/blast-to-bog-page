import { JUNCTION_METRES, BAY_SECONDS } from '../engine/road.js'

// Loader icon size in plan pixels. The invariant test uses the same box.
export const ICON = { width: 16, height: 12 }
// Passing bay slots beside a junction or the dump, by loader number.
// They sit clear of the drive and the crosscut centrelines.
export const SLOTS = [[-18, 16], [18, 16], [-18, -16], [18, -16]]

// Engine distances in metres. The renderer and invariant checker both consume this sample.
export function sampleRoad(layout, frame, time, out = {}) {
  const m = frame.motion
  const a = layout.nodes[m.from], b = layout.nodes[m.to]
  const length = m.from === m.to ? 0 : layout.edges[Math.max(m.from, m.to)].length
  const distance = Math.min(length, Math.max(0, m.metres + (time - m.at) * m.speed))
  const f = length ? distance / length : 0
  out.x = a.x + (b.x - a.x) * f
  out.y = a.y + (b.y - a.y) * f
  out.depth = frame.service ? Math.max(0, Math.min(1, (time - frame.service.start) / 5, (frame.service.end - time) / 5)) : 0
  // The final two metres of positioning at the face are within operator service.
  out.y += 2 * out.depth
  out.from = m.from
  out.to = m.to
  out.fraction = f
  out.distance = distance
  out.length = length
  out.lane = m.from === m.to ? 0 : Math.max(m.from, m.to)
  out.direction = Math.sign(m.to - m.from)
  out.station = out.direction > 0 ? distance : length - distance
  out.speed = m.speed
  return out
}

// Plan scale. The drive runs left to right from the dump and crosscuts run up
// to their brows, so a nearer junction has a longer crosscut.
export function planGeometry(layout, width = 320) {
  const B = layout.brows
  const left = 44, right = 30, top = 46, bottom = 32
  const reach = layout.nodes[B].x || 1
  const crosscut = Math.max(...layout.nodes.slice(B + 1).map(n => n.y), 1)
  const spacing = reach / B
  // A long drive widens the plan rather than shrinking it. A loader leaving a
  // junction zone must stay clear of a loader pulling out of a bay, and bays at
  // neighbouring junctions must not touch.
  const sx = Math.max((width - left - right) / reach, 36 / JUNCTION_METRES, 54 / spacing)
  width = Math.max(width, Math.ceil(left + right + reach * sx))
  // Crosscuts may be drawn shorter than the drive, but never so short that a
  // loader waiting outside a junction touches a passing bay.
  const sy = Math.min(sx, Math.max(150 / crosscut, 26 / JUNCTION_METRES))
  const driveY = top + crosscut * sy
  return { layout, B, sx, sy, left, driveY, width, height: driveY + bottom,
    px: node => [left + layout.nodes[node].x * sx, driveY - layout.nodes[node].y * sy] }
}

function toPx(g, x, y) {
  return [g.left + x * g.sx, g.driveY - y * g.sy]
}

// Waiting loaders pull into a bay at junctions. At the dump only the loader
// tipping (or stopped while tipping) stays at the tip itself.
export function inBay(g, frame) {
  const m = frame.motion
  if (!m || m.from !== m.to || m.from > g.B) return false
  return m.from > 0 || !(frame.state === 'driving' || frame.state === 'stopped')
}

function along(points, u) {
  const legs = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    legs.push(d)
    total += d
  }
  let s = Math.max(0, Math.min(1, u)) * total
  for (let i = 0; i < legs.length; i++) {
    if (s <= legs[i] || i === legs.length - 1) {
      const f = legs[i] ? Math.min(1, s / legs[i]) : 1
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f]
    }
    s -= legs[i]
  }
  return points.at(-1)
}

// Bay path: from the junction centre along the drive line, then out to the slot.
function bayPath(centre, id) {
  const [dx, dy] = SLOTS[id % SLOTS.length]
  return [centre, [centre[0] + dx, centre[1]], [centre[0] + dx, centre[1] + dy]]
}

export function planPosition(g, frame, time, id, s = sampleRoad(g.layout, frame, time)) {
  const m = frame.motion
  if (m.from === m.to) {
    const centre = m.from > g.B ? toPx(g, s.x, s.y) : g.px(m.from)
    if (!inBay(g, frame)) return centre
    const since = frame.bay?.since ?? -Infinity
    return along(bayPath(centre, id), (time - since) / BAY_SECONDS)
  }
  const point = toPx(g, s.x, s.y)
  if (!frame.fromBay) return point
  const zone = Math.min(JUNCTION_METRES, s.length)
  if (s.distance >= zone) return point
  const centre = g.px(m.from)
  const a = g.layout.nodes[m.from], b = g.layout.nodes[m.to]
  const exit = toPx(g, a.x + (b.x - a.x) * zone / s.length, a.y + (b.y - a.y) * zone / s.length)
  return along([...bayPath(centre, id).reverse(), exit], s.distance / zone)
}
