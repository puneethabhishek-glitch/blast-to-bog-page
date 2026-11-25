import { fillTimes, hangUpRates, fillFactorAtTime, mapShiftsFor } from '../engine/capacity.js'
import { byId } from './controls.js'
import { number, tonnes, share } from './charts.js'

function comparison([a, b]) {
  if ([a, b].includes('—')) return 'One or both blasts produce no tonnes across the tested fleets, so their limits cannot be compared.'
  if (a === b) return 'At these inputs both blasts allow the same number of loaders. The blast is not the binding limit here.' +
    (a === '6+' ? ' Both still gain at six loaders, the largest fleet tested.' : '')
  return 'Moving from Blast 1 to Blast 2 ' + (parseInt(a) > parseInt(b) ? 'drops' : 'raises') +
    " the operator’s limit from " + a + ' to ' + b + ' loaders.'
}

const cellLabel = (f, h) => number(f, 2) + ' s fill · ' + number(h, 2) + (h === 1 ? ' hang-up' : ' hang-ups') + ' per 100 buckets'
const coordinates = (f, h, factor) => JSON.stringify([f, h, factor])
const clamp = (v, low, high) => Math.max(low, Math.min(v, high))

export function setupCapacityMap() {
  const section = byId('capacity-map'), grid = byId('map-grid'), progress = byId('map-progress')
  const cells = []
  const data = new Map()
  let selected = 0, workers = [], signature, sharedSignature, generation = 0

  for (const f of fillTimes) byId('map-x').append(Object.assign(document.createElement('span'), { textContent: f }))
  for (const h of hangUpRates) {
    byId('map-y').append(Object.assign(document.createElement('span'), { textContent: h }))
    for (const f of fillTimes) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'capacity-cell'
      button.setAttribute('aria-label', cellLabel(f, h))
      const i = cells.length
      button.onfocus = button.onclick = () => select(i)
      button.onkeydown = event => {
        const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -fillTimes.length, ArrowDown: fillTimes.length }
        if (!(event.key in shifts)) return
        event.preventDefault()
        const next = i + shifts[event.key]
        if (next < 0 || next >= cells.length) return
        if (Math.abs(shifts[event.key]) === 1 && cells[next].h !== h) return
        cells[next].button.focus()
      }
      grid.append(button)
      cells.push({ f, h, button })
    }
  }
  function select(i) {
    cells[selected].button.tabIndex = -1
    cells[selected].button.removeAttribute('aria-current')
    selected = i
    const { button, f, h, key } = cells[i]
    button.tabIndex = 0
    button.setAttribute('aria-current', 'true')
    byId('map-detail-title').textContent = cellLabel(f, h)
    const rows = data.get(key)?.rows ?? []
    const body = byId('map-detail-rows')
    body.replaceChildren()
    for (const row of rows) {
      const tr = body.insertRow()
      for (const value of [row.N, tonnes(row.mean), share(row.operatorBusyShare)]) tr.insertCell().textContent = value
    }
  }
  function clearWorkers() {
    for (const worker of workers) worker.terminate()
    workers = []
  }
  function rebuild(plans) {
    const params = plans[0]
    const blasts = plans.map(({ fillTime, hangUpsPer100, fillFactor }) => ({ fillTime, hangUpsPer100, fillFactor }))
    const nextSignature = JSON.stringify([params, blasts])
    if (nextSignature === signature) return
    signature = nextSignature
    byId('map-note').textContent = 'Each square is ' + mapShiftsFor(params) + ' simulated shifts. Tap a square to see its numbers.'
    const run = ++generation
    clearWorkers()
    const started = performance.now()
    const jobs = new Map()
    function register(fillTime, hangUpsPer100, fillFactor) {
      const key = coordinates(fillTime, hangUpsPer100, fillFactor)
      jobs.set(key, { key, fillTime, hangUpsPer100, fillFactor })
      return key
    }
    // Cell keys already contain all three loading quantities. Reuse completed
    // squares when a marker, anchor or cost changes but the physical inputs match.
    const shared = { ...params }
    for (const key of ['table', 'x50', 'x80', 'fillTime', 'fillFactor', 'hangUpsPer100', 'outsideRange',
      'K_kg_per_m3', 'explosivePrice', 'inSituDensity']) delete shared[key]
    const sharedKey = JSON.stringify(shared)
    const cached = sharedKey === sharedSignature ? new Map(data) : new Map()
    sharedSignature = sharedKey
    data.clear()
    const byKey = new Map()
    for (const cell of cells) {
      cell.key = register(cell.f, cell.h, fillFactorAtTime(cell.f, params.table))
      byKey.set(cell.key, cell)
      cell.button.textContent = '·'
      cell.button.tabIndex = -1
      cell.button.removeAttribute('data-limit')
      cell.button.setAttribute('aria-label', cellLabel(cell.f, cell.h))
    }
    const keys = blasts.map(b => register(b.fillTime, b.hangUpsPer100, b.fillFactor))
    const markers = byId('map-markers'), labels = byId('map-blasts')
    markers.replaceChildren()
    labels.replaceChildren()
    blasts.forEach(({ fillTime: f, hangUpsPer100: h }, i) => {
      const dot = document.createElement('span')
      dot.className = 'blast-dot blast-' + (i + 1)
      dot.style.left = (clamp(f, 30, 120) - 25) + '%'
      dot.style.top = ((6.5 - clamp(h, 0, 6)) / 7 * 100) + '%'
      dot.textContent = i + 1
      const outside = f < 30 || f > 120 || h < 0 || h > 6
      dot.title = 'Blast ' + (i + 1) + ' · ' + cellLabel(f, h) + (outside ? ' (outside map)' : '')
      dot.setAttribute('aria-label', dot.title)
      markers.append(dot)
      const label = document.createElement('span')
      label.className = dot.className
      label.textContent = 'Blast ' + (i + 1) + ' · ' + number(f, 2) + ' s · ' + number(h, 2) + '/100' + (outside ? ' (outside map)' : '')
      labels.append(label)
    })
    select(selected)
    let complete = 0
    section.dataset.state = 'running'
    progress.textContent = '0 of 70 squares'
    byId('map-answer').hidden = true
    const list = [...jobs.values()].filter(job => !cached.has(job.key))
    const lanes = Math.min(4, navigator.hardwareConcurrency || 2)
    function fail(message) {
      if (run !== generation || section.dataset.state !== 'running') return
      clearWorkers()
      signature = null
      section.dataset.state = 'error'
      progress.textContent = 'Map could not finish. ' + message
    }
    function display(key, result) {
      data.set(key, result)
      const cell = byKey.get(key)
      if (cell) {
        cell.button.textContent = result.limit
        cell.button.dataset.limit = result.limit
        cell.button.setAttribute('aria-label', cellLabel(cell.f, cell.h) + (result.limit === '—' ? ', no production' : ', loader limit ' + result.limit))
        progress.textContent = ++complete + ' of 70 squares'
        if (cells[selected] === cell) select(selected)
      }
      if (data.size === jobs.size) {
        clearWorkers()
        byId('map-answer').textContent = comparison(keys.map(k => data.get(k).limit))
        byId('map-answer').hidden = false
        section.dataset.elapsedMs = Math.round(performance.now() - started)
        section.dataset.state = 'ready'
      }
    }
    for (const { key } of jobs.values()) if (cached.has(key)) display(key, cached.get(key))
    for (let lane = 0; lane < Math.min(lanes, list.length); lane++) {
      const worker = new Worker(new URL('./capacity-worker.js', import.meta.url), { type: 'module' })
      workers.push(worker)
      worker.onerror = event => fail(event.message)
      worker.onmessage = ({ data: { key, result, error } }) => {
        if (run !== generation || section.dataset.state !== 'running') return
        if (error) fail(error)
        else display(key, result)
      }
      worker.postMessage({ params, jobs: list.filter((_, index) => index % lanes === lane) })
    }
  }
  // Start the detail panel on the 60 s, one-hang-up square.
  selected = cells.findIndex(c => c.f === 60 && c.h === 1)
  return { rebuild }
}
