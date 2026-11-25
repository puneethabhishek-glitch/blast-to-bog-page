import { createParams, validateParams, tonnesPerBucket, costCheck, anchorDefaults } from '../engine/index.js'
import { setupControls, inputScenarios, showIssues, assumptions, byId, costKeys } from './controls.js'
import { drawCharts, number, tonnes, share } from './charts.js'
import { setupCapacityMap } from './capacity-map.js'
import { setupReplay } from './replay.js'

let revision = 0
let pendingTimer
let lastRun
const workers = [null, null]
const pending = [null, null]
const cache = [null, null]
const currency = (n, digits) => n.toLocaleString('en-AU', {
  style: 'currency', currency: 'AUD', minimumFractionDigits: digits, maximumFractionDigits: digits
})
function metrics(id, entries) {
  const root = byId(id)
  root.replaceChildren(...entries.map(([name, value, label, note]) => {
    const item = document.createElement('div')
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = value
    if (label) dd.insertAdjacentHTML('beforeend', ' <span class="badge" title="' + { A: 'Assumed', C: 'Calibrated', V: 'Verified' }[label] + '">' + label + '</span>')
    if (note) dd.append(Object.assign(document.createElement('small'), { textContent: note }))
    item.append(dt, dd)
    return item
  }))
}
function updateCost(params, series) {
  const count = Number(byId('cost-costCount').value)
  const result = costCheck(...params, series.map(s => s.results.find(r => r.N === count).mean), params[0])
  const high = params[1].K_kg_per_m3 > params[0].K_kg_per_m3 ? 1 : 0
  byId('cost-direction').textContent = 'Blast ' + (high + 1) + ' compared with Blast ' + (2 - high) + ' at ' + count + (count === 1 ? ' loader.' : ' loaders.')
  const equalPowder = params[0].K_kg_per_m3 === params[1].K_kg_per_m3
  if (equalPowder) byId('cost-direction').textContent = 'Both blasts use the same powder factor.'
  metrics('cost-values', [['Blast 1 explosive cost', currency(result.costs[0], 2) + '/t'],
    ['Blast 2 explosive cost', currency(result.costs[1], 2) + '/t'], ['Extra tonnes per shift', equalPowder ? '—' : tonnes(result.extraTonnes) + ' t']])
  byId('payback').hidden = false
  byId('payback').textContent = equalPowder ? 'The explosive cost per tonne is the same for both blasts.' :
    result.breakEvenValuePerTonne == null ? 'At ' + count + (count === 1 ? ' loader' : ' loaders') + ' the higher powder factor blast adds no tonnes, so the extra explosive does not pay back here.' :
    'The higher powder factor blast pays for its extra explosive if one extra bogged tonne is worth more than ' + currency(result.breakEvenValuePerTonne, 2) + '.'
}
function render(params, series) {
  params.forEach((p, i) => {
    const payload = tonnesPerBucket(p.bucketVolume, p.looseDensity, p.fillFactor, p.capacity)
    byId('s' + i + '-range').hidden = !p.outsideRange
    const preset = byId('s' + i + '-preset').value
    const anchor = anchorDefaults[preset]
    const label = key => anchor ? anchor[key].label : 'A'
    const formula = number(p.bucketVolume, 1) + ' m³ × ' + number(p.looseDensity, 2) + ' t/m³ × ' + share(p.fillFactor) + (payload.capped ? ', capped at ' + number(p.capacity, 1) + ' t' : '')
    metrics('s' + i + '-metrics', [['X50', number(p.x50, 1) + ' cm', label('x50')], ['Fill time', number(p.fillTime, 1) + ' s', label('fillTime')],
      ['Fill factor', share(p.fillFactor), label('fillFactor')], ['Hang-ups / 100', number(p.hangUpsPer100, 2), p.useOversize ? 'A' : label('hangUpsPer100')],
      ['Tonnes / bucket', payload.tonnes.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t', null, formula]])
  })
  drawCharts(series, params)
  updateCost(params, series)
  capacity.rebuild(params)
  replay.rebuild(params, series)
  assumptions(params)
}
function stop(i) {
  if (!pending[i]) return
  workers[i].terminate()
  workers[i] = null
  pending[i].reject(new Error('Inputs changed'))
  pending[i] = null
}
function calculate(raw, i) {
  const inputs = { ...raw }
  for (const key of costKeys) delete inputs[key]
  if (inputs.fragmentationMode !== 'kuzRam') delete inputs.K_kg_per_m3
  const key = JSON.stringify(inputs)
  if (cache[i]?.key === key) return Promise.resolve(cache[i].result)
  const worker = workers[i] ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    pending[i] = { reject }
    worker.onerror = event => {
      pending[i] = null
      worker.terminate()
      workers[i] = null
      reject(new Error(event.message))
    }
    worker.onmessage = ({ data }) => {
      pending[i] = null
      if (data.error) return reject(new Error(data.error))
      cache[i] = { key, result: data.result }
      resolve(data.result)
    }
    worker.postMessage(inputs)
  })
}
function refresh(changed) {
  const id = ++revision
  clearTimeout(pendingTimer)
  pending.forEach((_, i) => stop(i))
  const raw = inputScenarios(changed)
  const issues = raw.map(validateParams)
  showIssues(issues)
  const status = byId('status')
  if (issues.flat().some(issue => issue.severity === 'error')) {
    status.textContent = lastRun ? 'Check the highlighted inputs. Showing the last valid run.' : 'Check the highlighted inputs.'
    status.dataset.state = 'invalid'
    return
  }
  const params = raw.map(createParams)
  status.textContent = 'Running ' + number(params[0].shifts) + ' shifts'
  status.dataset.state = 'running'
  pendingTimer = setTimeout(async () => {
    try {
      const series = await Promise.all(raw.map(calculate))
      if (id !== revision) return
      lastRun = { params, series }
      render(params, series)
      status.textContent = number(params[0].shifts) + ' shifts per fleet'
      status.dataset.state = 'ready'
    } catch (error) {
      if (id === revision) {
        status.textContent = 'Simulation could not finish. ' + error.message
        status.dataset.state = 'error'
      }
    }
  }, changed ? 100 : 0)
}
setupControls()
const replay = setupReplay()
const capacity = setupCapacityMap()
document.addEventListener('input', event => {
  if (event.target.closest('#replay')) {
    if (event.target.id === 'replay-replayCount' && lastRun) {
      replay.rebuild(lastRun.params, lastRun.series)
      if (byId('status').dataset.state === 'ready') assumptions(lastRun.params)
    }
  } else if (event.target.id === 'cost-costCount') {
    if (lastRun && byId('status').dataset.state === 'ready') {
      updateCost(lastRun.params, lastRun.series)
      assumptions(lastRun.params)
    }
  } else refresh(event.target)
})
let chartWidth = 0
new ResizeObserver(([entry]) => {
  const width = entry.contentRect.width
  if (width !== chartWidth && lastRun) drawCharts(lastRun.series, lastRun.params)
  chartWidth = width
}).observe(byId('production-chart'))
refresh()
