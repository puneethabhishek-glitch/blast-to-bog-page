import { defaults, anchorDefaults, anchorTable, loaderOptions, comparisonDefaults } from '../engine/index.js'

export const warning = 'Kuz-Ram was developed for bench blasting. For ring-drilled stopes treat this as a rough guide and type in measured fragmentation if you have it.'
export const names = {
  preset: 'Fragmentation', x50: 'X50', K_kg_per_m3: 'Powder factor', A: 'Rock factor', Q_kg: 'Explosive per hole',
  RWS: 'Relative weight strength', B_m: 'Burden', S_m: 'Spacing', D_mm: 'Hole diameter', W_m: 'Drilling deviation',
  L_m: 'Charge length', H_m: 'Bench or ring height', oversizePercent: 'Measured oversize',
  useOversize: 'Hang-up rate source', oversizeSize: 'Oversize threshold', oversizeFactor: 'Oversize multiplier',
  loaderModel: 'Loader model', bucketIndex: 'Bucket', looseDensity: 'Loose density', fillCV: 'Fill time variability',
  trafficModel: 'Single lane traffic', minGapMetres: 'Minimum separation', resetPriority: 'Prioritise resets',
  takeoverSeconds: 'Remote takeover time', autoStopsPerHour: 'Auto-stops', autoStopResetMinutes: 'Reset time',
  tripCV: 'Trip time variability', distance: 'One-way tram distance', speedLoaded: 'Loaded speed', speedEmpty: 'Empty speed',
  positioningTime: 'Positioning time', clearMinutes: 'Hang-up clearing', rockbreakerShare: 'Secondary blast share', secondaryEntryMinutes: 'Secondary blast entry', firingWindows: 'Fire at crib and shift end', secondaryWholeLevel: 'Secondary blast isolates level', reEntryMinutes: 'Re-entry after firing',
  manualStopShare: 'Stops needing entry', manualEntryMinutes: 'Manual entry time',
  blockMinutes: 'Brow block time', relocationMinutes: 'Relocation time', handoverMinutes: 'Handover gap', cribMinutes: 'Crib break', operatorCeiling: 'Operator busy ceiling',
  dutyShare: 'Other duties share', dutyBlockMinutes: 'Duty block length', drawpoints: 'Open brows', shiftHours: 'Shift length',
  shifts: 'Shifts simulated', explosivePrice: 'Explosive price', inSituDensity: 'In-situ density',
  costCount: 'Fleet size', replayCount: 'Replay fleet', fillTime: 'Fill time', fillFactor: 'Fill factor', hangUpsPer100: 'Hang-ups',
  bucketVolume: 'Bucket volume', maxDensityKgM3: 'Maximum material density', capacity: 'Tramming capacity', dumpTime: 'Dump time'
}
const roughKeys = ['A', 'Q_kg', 'RWS', 'B_m', 'S_m', 'D_mm', 'W_m', 'L_m', 'H_m']
export const costKeys = ['explosivePrice', 'inSituDensity']
const percentKeys = ['fillCV', 'tripCV', 'rockbreakerShare', 'dutyShare', 'operatorCeiling', 'manualStopShare']
const anchorKeys = ['x50', 'fillTime', 'fillFactor', 'hangUpsPer100']
const loadingKeys = ['loaderModel', 'bucketIndex', 'looseDensity', 'fillCV']
const switches = ['trafficModel', 'resetPriority', 'firingWindows', 'secondaryWholeLevel']
const automationKeys = [...switches, 'minGapMetres', 'takeoverSeconds', 'autoStopsPerHour', 'autoStopResetMinutes', 'distance', 'speedLoaded', 'speedEmpty', 'positioningTime', 'tripCV', 'clearMinutes', 'rockbreakerShare', 'secondaryEntryMinutes', 'reEntryMinutes', 'manualStopShare', 'manualEntryMinutes',
  'blockMinutes', 'relocationMinutes', 'handoverMinutes', 'cribMinutes', 'operatorCeiling', 'dutyShare', 'dutyBlockMinutes', 'drawpoints', 'shiftHours', 'shifts']
const blastKeys = ['useOversize', 'oversizeSize', 'oversizeFactor']
const sharedKeys = [...loadingKeys, ...automationKeys, ...blastKeys, ...costKeys]
const displayUnits = { preset: 'class', loaderModel: 'model', bucketIndex: 'm³', useOversize: 'mode', hangUpsPer100: '/100 buckets',
  oversizeFactor: 'events/100 per %', fillFactor: 'fraction', RWS: '% of ANFO' }
const labels = { A: 'Assumed', C: 'Calibrated', V: 'Verified' }
export const byId = id => document.getElementById(id)
const badge = value => '<span class="badge" title="' + labels[value] + '">' + value + '</span>'
const metadata = key => comparisonDefaults[key] ?? defaults[key === 'preset' ? 'fragmentationMode' : key]
export const unit = key => percentKeys.includes(key) ? '%' : displayUnits[key] ?? metadata(key).unit
const percentScale = key => percentKeys.includes(key) ? 100 : 1
const fieldId = (scope, key) => scope + '-' + key
const options = choices => choices.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')
const bucketChoices = model => loaderOptions[model].buckets.map((b, i) => [i, b.volume.toFixed(1) + ' m³ · ' + b.type])

function field(scope, key, { choices, value = metadata(key).value, tableLabel } = {}) {
  const id = fieldId(scope, key)
  const caption = tableLabel ? `<label class="sr-only" for="${id}">${tableLabel}</label>`
    : `<label for="${id}">${names[key]} <span class="meta"><span class="unit">${unit(key)}</span> ${badge(metadata(key).label)}</span></label>`
  const control = choices ? `<select id="${id}" name="${id}">${options(choices)}</select>` :
    `<input type="number" inputmode="decimal" step="any" id="${id}" name="${id}" value="${value == null ? '' : value}">`
  return `<div class="field">${caption}${control}<small class="issue" id="${id}-issue"></small></div>`
}
function numeric(scope, key, value = metadata(key).value) {
  return field(scope, key, { value: value == null ? null : value * percentScale(key) })
}

function scenarioCard(scenario, i) {
  const s = 's' + i
  const presets = [...anchorTable.map(a => [a.name, a.name]), ['direct', 'Type X50'], ['kuzRam', 'Estimate from blast design (rough guide)']]
  return `<section class="scenario" aria-labelledby="${s}-title"><h2 id="${s}-title">Blast ${i + 1}</h2>
    <div class="scenario-controls">${field(s, 'preset', { choices: presets })}${field(s, 'K_kg_per_m3', { value: scenario.powderFactor.toFixed(2) })}</div>
    <div class="extras"><div id="${s}-direct" hidden>${numeric(s, 'x50', anchorTable.find(a => a.name === scenario.preset).x50)}</div>
      <div id="${s}-rough" hidden><p class="notice">${warning}</p><div class="fields">${roughKeys.map(k => numeric(s, k)).join('')}</div></div>
      <div id="${s}-oversize" hidden>${numeric(s, 'oversizePercent')}</div></div>
    <p id="${s}-range" class="notice" hidden>outside the anchor range</p><dl id="${s}-metrics" class="metrics"></dl></section>`
}
function anchors() {
  const head = anchorKeys.map(key => `<th scope="col">${names[key]}<br><span class="unit">${unit(key)}</span></th>`).join('')
  const rows = anchorTable.map((a, i) => {
    const cells = anchorKeys.map(key => {
      const { value, label } = anchorDefaults[a.name][key]
      const tableLabel = a.name + ' ' + names[key] + ', ' + labels[label]
      return '<td>' + badge(label) + field('anchor' + i, key, { value, tableLabel }) + '</td>'
    })
    return '<tr><th scope="row">' + a.name + '</th>' + cells.join('') + '</tr>'
  })
  return '<table class="anchor-grid"><caption>Fragmentation anchors</caption><thead><tr><th>Class</th>' + head +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'
}
function group(title, contents) {
  return `<details><summary>${title}</summary>${contents}</details>`
}
export function setupControls() {
  const { scenarios, counts, costCount } = comparisonDefaults
  byId('scenarios').innerHTML = scenarios.map(scenarioCard).join('')
  scenarios.forEach((s, i) => { byId('s' + i + '-preset').value = s.preset })
  const shared = key => numeric('shared', key)
  byId('shared').innerHTML = [
    group('Blast', anchors() + '<div class="fields">' + field('shared', 'useOversize', { choices: [['off', 'Anchor table'], ['on', 'Oversize percentage']] }) +
      blastKeys.slice(1).map(shared).join('') + '</div>'),
    group('Loading', '<div class="fields">' + field('shared', 'loaderModel', { choices: Object.keys(loaderOptions).map(m => [m, m]) }) +
      field('shared', 'bucketIndex', { choices: bucketChoices(defaults.loaderModel.value) }) + loadingKeys.slice(2).map(shared).join('') + '</div>'),
    group('Automation', '<div class="fields">' + automationKeys.map(key => key === 'drawpoints'
      ? field('shared', key, { choices: [2, 3, 4].map(n => [n, n]) }) : switches.includes(key) ? field('shared', key, { choices: [['on', 'On'], ['off', 'Off']] }) : shared(key)).join('') + '</div>')
  ].join('')
  byId('cost-picker').innerHTML = field('cost', 'costCount', { choices: counts.map(n => [n, n]) })
  byId('cost-costCount').value = costCount.value
  byId('replay-picker').innerHTML = field('replay', 'replayCount', { choices: counts.map(n => [n, n]) })
  byId('replay-replayCount').value = comparisonDefaults.replayCount.value
  byId('shared-drawpoints').value = defaults.drawpoints.value
  byId('cost-inputs').innerHTML = costKeys.map(shared).join('')
  document.querySelector('.rough-warning').textContent = warning
  byId('inputs').onsubmit = event => event.preventDefault()
}

function read(scope, key) {
  const el = byId(fieldId(scope, key))
  if (key === 'loaderModel' || key === 'preset') return el.value
  if (key === 'useOversize' || switches.includes(key)) return el.value === 'on'
  if (el.tagName === 'SELECT') return Number(el.value)
  if (key === 'oversizePercent' && el.value === '') return null
  return el.valueAsNumber / percentScale(key)
}
export function inputScenarios(changed) {
  if (changed?.id === 'shared-trafficModel') byId('shared-resetPriority').value = changed.value
  if (changed?.id === 'shared-loaderModel') byId('shared-bucketIndex').innerHTML = options(bucketChoices(changed.value))
  const shared = Object.fromEntries(sharedKeys.map(key => [key, read('shared', key)]))
  const table = anchorTable.map(({ name }, i) => ({ name, ...Object.fromEntries(anchorKeys.map(key => [key, read('anchor' + i, key)])) }))
  for (const key of blastKeys.slice(1)) {
    byId(fieldId('shared', key)).closest('.field').hidden = !shared.useOversize
    if (!shared.useOversize) delete shared[key]
  }
  return comparisonDefaults.scenarios.map((_, i) => {
    const scope = 's' + i
    const preset = read(scope, 'preset')
    byId(scope + '-direct').hidden = preset !== 'direct'
    byId(scope + '-rough').hidden = preset !== 'kuzRam'
    byId(scope + '-oversize').hidden = !shared.useOversize || preset === 'kuzRam'
    const raw = { ...shared, table, K_kg_per_m3: read(scope, 'K_kg_per_m3') }
    if (preset === 'kuzRam') {
      raw.fragmentationMode = 'kuzRam'
      for (const key of roughKeys) raw[key] = read(scope, key)
    } else {
      raw.x50 = preset === 'direct' ? read(scope, 'x50') : table.find(a => a.name === preset).x50
      if (shared.useOversize) raw.oversizePercent = read(scope, 'oversizePercent')
    }
    return raw
  })
}
export function showIssues(allIssues) {
  document.querySelectorAll('.issue:not(:empty)').forEach(el => {
    el.textContent = ''
    el.classList.remove('warning')
    const input = byId(el.id.slice(0, -6))
    input.removeAttribute('aria-invalid')
    input.removeAttribute('aria-describedby')
  })
  allIssues.forEach((issues, i) => {
    for (const { field, severity, message } of issues) {
      const path = field?.split('.')
      const id = path?.[0] === 'table' ? fieldId('anchor' + path[1], path[2])
        : fieldId(sharedKeys.includes(field) ? 'shared' : 's' + i, field)
      const input = byId(id)
      if (!input) continue
      const hint = byId(id + '-issue')
      hint.textContent = message
      hint.classList.toggle('warning', severity === 'warning')
      input.setAttribute('aria-describedby', hint.id)
      if (severity === 'error') input.setAttribute('aria-invalid', 'true')
    }
  })
}

export function assumptions(params) {
  const rows = []
  function add(name, value, units, meta) {
    rows.push([name, String(value), units, meta.label, meta.sourceUrl ? meta.source + ' ' + meta.sourceUrl : meta.source])
  }
  function addInput(scope, key, prefix = '', meta = metadata(key)) {
    const el = byId(fieldId(scope, key))
    const value = el.selectedOptions?.[0]?.textContent ?? el.value
    const machine = loaderOptions[params[0].loaderModel]
    const source = meta.label === 'V' ? machine.source + ' ' + machine.sheet : meta.source
    add(prefix + names[key], value || 'Unspecified', unit(key), { ...meta, source })
  }
  params.forEach((p, i) => {
    const prefix = 'Blast ' + (i + 1) + ' · '
    const scope = 's' + i
    for (const key of ['preset', 'K_kg_per_m3']) addInput(scope, key, prefix)
    if (p.fragmentationMode === 'kuzRam') roughKeys.forEach(k => addInput(scope, k, prefix))
    if (read(scope, 'preset') === 'direct') addInput(scope, 'x50', prefix)
    if (p.useOversize && p.fragmentationMode !== 'kuzRam') addInput(scope, 'oversizePercent', prefix)
  })
  for (const [i, a] of anchorTable.entries()) {
    for (const key of anchorKeys) addInput('anchor' + i, key, a.name + ' · ', anchorDefaults[a.name][key])
  }
  for (const key of sharedKeys) {
    if (!byId(fieldId('shared', key)).closest('.field').hidden) addInput('shared', key)
  }
  const distribution = defaults.fillDistribution
  add('Fill time distribution', distribution.value, distribution.unit, distribution)
  const p = params[0]
  const machine = loaderOptions[p.loaderModel]
  for (const key of ['bucketVolume', 'maxDensityKgM3', 'capacity', 'dumpTime']) {
    add(names[key], p[key], unit(key), { ...defaults[key], source: machine.source + ' ' + machine.sheet })
  }
  addInput('cost', 'costCount')
  addInput('replay', 'replayCount')
  const table = document.createElement('table')
  table.className = 'assumption-table'
  table.innerHTML = '<thead><tr><th>Input</th><th>Value</th><th>Unit</th><th>Label</th><th>Source</th></tr></thead>'
  const body = table.createTBody()
  for (const row of rows) {
    const tr = body.insertRow()
    for (const [i, value] of row.entries()) {
      const cell = tr.insertCell()
      if (i === 3) cell.innerHTML = badge(value)
      else if (i === 4 && value.includes('https://')) {
        const link = document.createElement('a')
        link.href = value.slice(value.indexOf('https://'))
        link.textContent = value.slice(0, value.indexOf('https://')).trim() || 'Source'
        cell.append(link)
      } else cell.textContent = value
    }
  }
  byId('assumptions').replaceChildren(table)
}
