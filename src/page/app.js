import { createParams, validateParams, tonnesPerBucket, costCheck } from '../engine/index.js'
import { setupControls, inputScenarios, showIssues, assumptions, byId, costKeys } from './controls.js'
import { drawCharts, number, tonnes, share } from './charts.js'
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
  root.replaceChildren(...entries.map(([name, value]) => {
    const item = document.createElement('div')
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = value
    item.append(dt, dd)
    return item
  }))
}
function updateCost(params, series) {
  const count = Number(byId('cost-costCount').value)
  const result = costCheck(...params, series.map(s => s.results.find(r => r.N === count).mean), params[0])
  const high = params[1].K_kg_per_m3 > params[0].K_kg_per_m3 ? 1 : 0
  byId('cost-direction').textContent = 'Blast ' + (high + 1) + ' compared with Blast ' + (2 - high) + ' at ' + count + (count === 1 ? ' loader.' : ' loaders.')
  metrics('cost-values', [['Blast 1 explosive cost', currency(result.costs[0], 2) + '/t'],
    ['Blast 2 explosive cost', currency(result.costs[1], 2) + '/t'], ['Extra tonnes per shift', tonnes(result.extraTonnes) + ' t'],
    ['Net value per shift', currency(result.netValue, 0)]])
  byId('payback').hidden = false
  byId('payback').textContent = 'At these inputs, the extra explosive ' + (result.paysBack ? 'pays back' : 'does not pay back') + ' if the level can take the extra tonnes.'
}
function render(params, series) {
  params.forEach((p, i) => {
    const payload = tonnesPerBucket(p.bucketVolume, p.looseDensity, p.fillFactor, p.capacity)
    byId('s' + i + '-range').hidden = !p.outsideRange
    metrics('s' + i + '-metrics', [['X50', number(p.x50, 1) + ' cm'], ['Fill time', number(p.fillTime, 1) + ' s'],
      ['Fill factor', share(p.fillFactor)], ['Hang-ups / 100', number(p.hangUpsPer100, 2)],
      ['Tonnes / bucket', payload.tonnes.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' t']])
  })
  drawCharts(series, params)
  updateCost(params, series)
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
