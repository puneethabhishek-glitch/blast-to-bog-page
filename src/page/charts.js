import { byId } from './controls.js'

const svgNS = 'http://www.w3.org/2000/svg'
const palette = ['#096951', '#a64624']
export const number = (value, digits = 0) => value.toLocaleString('en-AU', { maximumFractionDigits: digits })
export const tonnes = value => number(Math.round(value / 10) * 10)
export const share = fraction => number(100 * fraction) + '%'
const accounts = [
  ['driving', 'Driving', '#267562'], ['filling', 'Filling', '#304e70'],
  ['waitingOperator', 'Waiting for operator', '#c38742'], ['waitingDrawpoint', 'Waiting for a brow', '#a7bcd0'],
  ['traffic', 'Waiting for traffic', '#3f4a54'], ['blocked', 'Blocked by hang-up', '#a65039'], ['stopped', 'Stopped for reset', '#81629a'], ['isolated', 'Stopped, level isolated', '#8c2f5a'], ['idle', 'Idle', '#b9c4bd']
]
const duties = [accounts[1], ['takeover', 'Takeover', '#567d96'], ['resets', 'Resets', '#81629a'], ['clearing', 'Clearing hang-ups', '#a65039'], ['otherDuties', 'Other duties', '#c38742']]

export function mark(parent, tag, attrs = {}, text) {
  const node = document.createElementNS(svgNS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  if (text !== undefined) node.textContent = text
  parent.append(node)
  return node
}
function svg(parent, width, height, title) {
  const plot = mark(parent, 'svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': title })
  mark(plot, 'title', {}, title)
  return plot
}
function html(parent, tag, text, cls) {
  const el = document.createElement(tag)
  if (text != null) el.textContent = text
  if (cls) el.className = cls
  parent.append(el)
  return el
}
function dataTable(parent, headings, rows) {
  const details = html(parent, 'details', null, 'chart-data')
  html(details, 'summary', 'View chart data')
  const table = html(details, 'table')
  const header = table.createTHead().insertRow()
  for (const title of headings) html(header, 'th', title).scope = 'col'
  const body = table.createTBody()
  for (const values of rows) {
    const row = body.insertRow()
    values.forEach(value => { row.insertCell().textContent = value })
  }
}
function niceStep(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value || 1))
  return [1, 2, 2.5, 5, 10].find(n => n * magnitude >= value) * magnitude
}
function production(series, width, ceiling) {
  const container = byId('production-chart')
  container.replaceChildren()
  const h = width < 520 ? 237 : 268
  const left = 48, right = 15, top = 36, bottom = h - 25
  const max = Math.max(1, ...series.flatMap(s => s.results.map(r => Math.max(r.mean, r.p90))))
  const step = Math.ceil(niceStep(max / 4) / 10) * 10
  const limit = Math.ceil(max / step) * step
  const counts = series[0].results.map(r => r.N)
  const x = n => left + counts.indexOf(n) / (counts.length - 1) * (width - left - right)
  const y = t => bottom - t / limit * (bottom - top)
  const plot = svg(container, width, h, 'Mean tonnes per shift and P10 to P90 uncertainty by fleet size')
  for (let j = 0; j <= Math.round(limit / step); j++) {
    const t = j * step
    mark(plot, 'line', { x1: left, x2: width - right, y1: y(t), y2: y(t), class: 'tick' })
    mark(plot, 'text', { x: left - 7, y: y(t) + 4, 'text-anchor': 'end' }, tonnes(t))
  }
  for (const n of counts) mark(plot, 'text', { x: x(n), y: bottom + 19, 'text-anchor': 'middle' }, n)
  function points(rows, field) { return rows.map(r => x(r.N) + ',' + y(r[field])).join(' ') }
  series.forEach(({ results }, i) => {
    mark(plot, 'polygon', { class: 'range-band', points: points(results, 'p90') + ' ' + points([...results].reverse(), 'p10'),
      fill: palette[i], opacity: '.17' })
  })
  const notes = byId('knees')
  notes.replaceChildren()
  const labels = { operator: 'Operator limit', brows: 'Brow limit', gain: 'Next loader adds under 10%' }
  series.forEach(({ results, limit, reason }, i) => {
    const color = palette[i]
    mark(plot, 'polyline', { class: 'mean-line', points: points(results, 'mean'), fill: 'none', stroke: color,
      'stroke-width': 3, 'stroke-dasharray': i ? '8 4' : 'none', 'stroke-linejoin': 'round' })
    for (const r of results) {
      const dot = mark(plot, 'circle', { cx: x(r.N), cy: y(r.mean), r: r.N === limit ? 6 : 3.5,
        fill: color, stroke: '#fff', 'stroke-width': 1.5 })
      mark(dot, 'title', {}, `Blast ${i + 1}, ${r.N} loaders, ${tonnes(r.mean)} tonnes per shift`)
    }
    if (results.every(r => r.mean === 0)) {
      html(notes, 'p', `Blast ${i + 1}: no tonnes bogged at these fleet sizes`)
    } else if (limit == null) {
      html(notes, 'p', `Blast ${i + 1}: up to ${counts.at(-1)} loaders the operator stays at or below the ${share(ceiling)} ceiling and every extra loader adds 10% or more`)
    } else {
      const row = results.find(r => r.N === limit)
      // Separate label lanes remain legible when the two limits coincide.
      const labelY = 12 + i * 16
      const labelX = Math.max(left, Math.min(width - 170, x(limit) - 30))
      mark(plot, 'path', { d: `M${x(limit)},${y(row.mean) - 7} V${labelY + 4} H${labelX}`, fill: 'none', stroke: color, 'stroke-dasharray': '2 3' })
      mark(plot, 'text', { x: labelX, y: labelY, style: 'fill:' + color }, labels[reason])
      html(notes, 'p', `Blast ${i + 1}: ${limitText(limit)}. ${reasonText(results, limit, reason, ceiling)}`, 'knee-key' + (i ? ' second' : ''))
    }
  })
  html(container, 'p', 'Loaders per operator', 'axis-title')
  dataTable(container, ['Blast', 'Loaders', 'Mean (t)', 'P10 (t)', 'P90 (t)'], series.flatMap((s, i) =>
    s.results.map(r => [i + 1, r.N, tonnes(r.mean), tonnes(r.p10), tonnes(r.p90)])))
}
function bars(kind, series, shiftHours) {
  const isTime = kind === 'loader'
  const parent = byId(kind + '-bars')
  parent.replaceChildren()
  const categories = isTime ? accounts : duties
  const legend = html(parent, 'div', null, 'legend')
  for (const [, name, color] of categories) {
    const key = html(legend, 'span')
    html(key, 'i', null, 'swatch').style.backgroundColor = color
    key.append(name)
  }
  const width = Math.max(220, parent.clientWidth)
  series.forEach(({ results }, i) => {
    const group = html(parent, 'div', null, 'bar-group')
    html(group, 'h3', 'Blast ' + (i + 1))
    const plot = svg(group, width, results.length * 26 + 19, isTime ? 'Loader time in hours by fleet size' : 'Operator duties as a share of shift')
    const left = 28, right = width - 47, span = right - left
    const scale = isTime ? shiftHours : 1
    results.forEach((r, j) => {
      const y = 4 + j * 26
      mark(plot, 'text', { x: 3, y: y + 12 }, r.N)
      mark(plot, 'rect', { x: left, y, width: span, height: 15, fill: '#eff2ee' })
      let pos = left
      for (const [key, name, color] of categories) {
        const value = isTime ? r.meanTime[key] / 3600 : r.operatorShares[key]
        const pixels = span * value / scale
        const bar = mark(plot, 'rect', { x: pos, y, width: pixels, height: 15, fill: color })
        mark(bar, 'title', {}, name + ' · ' + (isTime ? number(value, 2) + ' h' : share(value)))
        pos += pixels
      }
      mark(plot, 'text', { x: right + 5, y: y + 12 }, isTime ? number(shiftHours, 1) + ' h' : share(r.operatorBusyShare))
    })
    mark(plot, 'text', { x: 0, y: results.length * 26 + 12 }, 'Loaders')
  })
  const rows = series.flatMap((s, i) => categories.map(([key, name]) => [
    'Blast ' + (i + 1) + ' · ' + name,
    ...s.results.map(r => isTime ? number(r.meanTime[key] / 3600, 2) : share(r.operatorShares[key]))
  ]))
  dataTable(parent, [isTime ? 'Hours' : 'Share', ...series[0].results.map(r => r.N)], rows)
}
export function drawCharts(series, params) {
  const open = [...document.querySelectorAll('.chart-data')].map(d => d.open)
  const ceiling = params[0].operatorCeiling
  production(series, Math.max(220, byId('production-chart').clientWidth), ceiling)
  bars('loader', series, params[0].shiftHours)
  bars('operator', series, params[0].shiftHours)
  document.querySelectorAll('.chart-data').forEach((d, i) => { d.open = open[i] ?? false })
  const n = compareAt(series)
  const rows = series.map(x => x.results.find(r => r.N === n))
  const answer = byId('answer')
  answer.hidden = false
  answer.textContent = `At ${n} ${n === 1 ? 'loader' : 'loaders'} the operator is busy ${share(rows[0].operatorBusyShare)} of working time with Blast 1 and ${share(rows[1].operatorBusyShare)} with Blast 2. The ceiling is ${share(ceiling)}.`
  headline(series, ceiling, params.map(caseName))
}
const counts = series => series[0].results.map(r => r.N)
// Compare the operator's load for both blasts at the larger of the two limits.
const compareAt = series => Math.max(1, Math.min(counts(series).at(-1), Math.max(...series.map(x => x.limit ?? counts(series).at(-1)))))
export function caseName(p, i) {
  const preset = document.getElementById('s' + i + '-preset')?.value
  const detail = ['Fine', 'Normal', 'Coarse'].includes(preset) ? preset + ' muck' : 'X50 ' + number(p.x50, 1) + ' cm'
  return 'Blast ' + (i + 1) + ' · ' + detail
}
export const limitText = limit => limit == null ? 'More than the fleets tested' : limit === 0 ? 'No tested fleet' : limit + (limit === 1 ? ' loader' : ' loaders')
export const seconds = value => value == null ? '—' : value < 90 ? number(value) + ' s' : number(value / 60, 1) + ' min'
export function reasonText(results, limit, reason, ceiling) {
  const next = results.find(r => r.N === limit + 1)
  if (reason === 'none') return `Even one loader keeps the operator above the ${share(ceiling)} ceiling`
  if (reason === 'operator') {
    // Show a decimal when whole percentages would hide that the share is above the ceiling.
    const busy = next.operatorBusyShare
    const shown = Math.round(100 * busy) <= Math.round(100 * ceiling) ? number(100 * busy, 1) + '%' : share(busy)
    return `A ${ordinal(limit + 1)} loader would keep the operator ${shown} busy, above the ${share(ceiling)} ceiling`
  }
  if (reason === 'brows') return 'Every open brow is in use, so another loader mostly waits for a brow'
  return 'Another loader adds under 10% to mean tonnes'
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th')
function headline(series, ceiling, names) {
  const list = byId('headline-result')
  list.replaceChildren()
  const n = compareAt(series)
  series.forEach(({ results, limit, reason }, i) => {
    const item = html(list, 'div')
    html(item, 'dt', names[i])
    const value = html(item, 'dd', results.every(r => r.mean === 0) ? 'No tonnes' : limitText(limit))
    if (limit != null) html(value, 'small', reasonText(results, limit, reason, ceiling) + '.')
    const row = results.find(r => r.N === n)
    if (row) html(value, 'small', `At ${n} ${n === 1 ? 'loader' : 'loaders'} the operator is ${share(row.operatorBusyShare)} busy. 9 in 10 fills start within ${seconds(row.waitP90.fill)} of a loader joining the queue, and 9 in 10 resets within ${seconds(row.waitP90.reset)}.`)
  })
  byId('headline-reason').textContent = `How many loaders one operator can run with each blast, in this simulation. The limit is the largest fleet that keeps the operator at or below ${share(ceiling)} busy over working time, unless the next loader already adds under 10%. The ceiling is an assumption you can change under Automation.`
  byId('headline').hidden = false
}
