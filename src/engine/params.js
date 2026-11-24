import { kuzRam, loadingFromX50 } from './fragmentation.js'

const assumed = (value, unit, source = "Assumed. Change to your site's value.") =>
  ({ value, unit, label: 'A', source })
const verified = (value, unit, source) => ({ value, unit, label: 'V', source })
const sheet = model => 'https://www.mining.sandvik/globalassets/products/underground-loaders-and-trucks/pdf/' +
  model.toLowerCase() + '-specification-sheet-english.pdf'

function bucket(type, volume, maxDensityKgM3) {
  return { type, volume, maxDensityKgM3 }
}

// Keep lip types distinct even when their heaped volumes match.
export const loaderOptions = {
  LH621i: {
    capacity: 21, dumpTime: 1.8, sheet: sheet('LH621i'), source: 'Sandvik TS3-LH621i-13',
    buckets: [
      bucket('G.E.T.', 8, 2400), bucket('G.E.T.', 9, 2100), bucket('G.E.T.', 10.7, 1700),
      bucket('G.E.T. Half Arrow', 11.2, 1700), bucket('Bare Lip', 8, 2600),
      bucket('Bare Lip', 9, 2200), bucket('Bare Lip', 10.7, 1800), bucket('MAKO', 10.7, 1700)
    ]
  },
  LH517i: {
    capacity: 17.2, dumpTime: 2, sheet: sheet('LH517i'), source: 'Sandvik TS3-LH517i-B-05',
    buckets: [
      bucket('G.E.T.', 7, 2400), bucket('G.E.T.', 7.6, 2100), bucket('G.E.T.', 8.6, 1800),
      bucket('G.E.T. Half Arrow', 9.1, 1700), bucket('Bare Lip Ejector', 7, 2200),
      bucket('Bare Lip', 7.6, 2200), bucket('Bare Lip', 8.4, 2000), bucket('MAKO', 8.6, 1800)
    ]
  }
}

export const anchorTable = [
  { name: 'Fine', x50: 15, fillTime: 45, fillFactor: 0.95, hangUpsPer100: 0.5 },
  { name: 'Normal', x50: 25, fillTime: 60, fillFactor: 0.90, hangUpsPer100: 1 },
  { name: 'Coarse', x50: 40, fillTime: 90, fillFactor: 0.80, hangUpsPer100: 3 }
]

const normal = anchorTable[1]
const anchorSource = 'Assumed starting values. The main question for site engineers.'
const variability = 'Assumed spread around the mean.'
const kuzSource = 'Assumed example for the rough guide.'
const machine = loaderOptions.LH621i
const machineSource = machine.source + ', pp. 2 and 6. ' + machine.sheet
export const defaults = {
  loaderModel: verified('LH621i', 'model', machineSource),
  bucketIndex: verified(0, 'index in selected model’s bucket list', machineSource),
  bucketVolume: verified(machine.buckets[0].volume, 'm³', machineSource),
  maxDensityKgM3: verified(machine.buckets[0].maxDensityKgM3, 'kg/m³', machineSource),
  capacity: verified(machine.capacity, 't', machineSource),
  dumpTime: verified(machine.dumpTime, 's', machineSource),
  looseDensity: assumed(2, 't/m³', 'Typical blasted gold ore, site input.'),
  speedLoaded: assumed(10, 'km/h', 'Assumed below the LH621i third gear speed.'),
  speedEmpty: assumed(12, 'km/h', 'Assumed below the LH621i third gear speed.'),
  distance: assumed(150, 'm'), positioningTime: assumed(30, 's'),
  fragmentationMode: assumed('direct', 'mode', 'Choose a loading class, a measured size or the rough guide.'),
  table: assumed(anchorTable, 'cm, s, fraction, events/100 buckets', anchorSource),
  x50: assumed(normal.x50, 'cm', anchorSource),
  x80: assumed(null, 'cm', 'Optional measured 80% passing size.'),
  fillTime: assumed(normal.fillTime, 's', anchorSource),
  fillFactor: assumed(normal.fillFactor, 'fraction', anchorSource),
  hangUpsPer100: assumed(normal.hangUpsPer100, 'events/100 buckets', anchorSource),
  useOversize: assumed(false, 'on/off', 'Optional rate based on the percentage of oversize rock.'),
  oversizePercent: assumed(null, '%', 'Measured retained percentage, or derived in Kuz-Ram mode.'),
  oversizeFactor: assumed(1, 'events/100 buckets per percentage point', 'Editable unit multiplier.'),
  oversizeSize: assumed(0.8, 'm'),
  A: assumed(8, 'rock factor', kuzSource), K_kg_per_m3: assumed(0.8, 'kg/m³', 'Assumed. Use your own blast design.'),
  Q_kg: assumed(25, 'kg', kuzSource), RWS: assumed(100, '% of ANFO strength', kuzSource),
  B_m: assumed(2, 'm', kuzSource), S_m: assumed(2.5, 'm', kuzSource),
  D_mm: assumed(89, 'mm', kuzSource), W_m: assumed(0.2, 'm', kuzSource),
  L_m: assumed(12, 'm', kuzSource), H_m: assumed(15, 'm', kuzSource),
  clearMinutes: assumed(4, 'min'), rockbreakerShare: assumed(0.30, 'fraction'),
  blockMinutes: assumed(30, 'min'), relocationMinutes: assumed(5, 'min'),
  shiftHours: assumed(12, 'h', 'Assumed shift length based on a common WA roster.'),
  handoverMinutes: assumed(15, 'min'), dutyShare: assumed(0.10, 'fraction'),
  dutyBlockMinutes: assumed(3, 'min', 'Assumed duration of each other-duty job.'),
  fillCV: assumed(0.20, 'CV', variability), tripCV: assumed(0.10, 'CV', variability),
  drawpoints: assumed(3, 'drawpoints'), shifts: assumed(500, 'shifts'),
  explosivePrice: assumed(1.50, '$/kg', 'Assumed price, no public WA price.'),
  inSituDensity: assumed(2.8, 't/m³'), valuePerTonne: assumed(15, '$/t', 'Site value of an extra bogged tonne.')
}

const values = Object.fromEntries(Object.entries(defaults).map(([key, entry]) => [key, entry.value]))

export const comparisonDefaults = {
  scenarios: [{ preset: 'Normal', powderFactor: defaults.K_kg_per_m3.value }, { preset: 'Coarse', powderFactor: 0.60 }],
  counts: [1, 2, 3, 4], costCount: assumed(3, 'loaders', 'Selected fleet for the cost comparison.'),
  replayCount: assumed(3, 'loaders', 'Selected fleet for the shift replay.'), seed: 24
}

/** Resolve raw overrides. Model/bucket selection and anchors supply dependent defaults. */
export function createParams(overrides = {}) {
  const p = { ...values, ...overrides }
  const model = loaderOptions[p.loaderModel]
  const selected = model?.buckets?.[p.bucketIndex]
  if (!Number.isInteger(p.bucketIndex) || !selected) throw new RangeError('Select a listed loader model and bucket.')
  p.bucketVolume = selected.volume
  p.maxDensityKgM3 = selected.maxDensityKgM3
  p.capacity = model.capacity
  p.dumpTime = overrides.dumpTime ?? model.dumpTime
  if (p.fragmentationMode === 'kuzRam') {
    const estimate = kuzRam(p)
    p.x50 = estimate.x50
    p.x80 = estimate.x80
    p.oversizePercent = estimate.percentRetained(100 * p.oversizeSize)
  } else if (p.fragmentationMode !== 'direct') {
    throw new RangeError('Choose direct or kuzRam fragmentation.')
  }
  const loading = loadingFromX50(p.x50, p.table)
  p.table = p.table.map(anchor => ({ ...anchor }))
  p.fillTime = overrides.fillTime ?? loading.fillTime
  p.fillFactor = overrides.fillFactor ?? loading.fillFactor
  p.hangUpsPer100 = overrides.hangUpsPer100 ?? loading.hangUpsPer100
  if (p.useOversize) {
    if (p.oversizePercent == null) throw Object.assign(new RangeError('Enter an oversize percentage for the oversize-driven hang-up rate.'), { field: 'oversizePercent' })
    p.hangUpsPer100 = Math.min(100, p.oversizePercent * p.oversizeFactor)
  }
  p.outsideRange = loading.outsideRange
  return p
}

/** Each issue has severity 'error' or 'warning' and a displayable message. */
export function validateParams(overrides = {}) {
  let p
  try { p = createParams(overrides) }
  catch (error) { return [{ field: error.field, severity: 'error', message: error.message }] }
  const issues = []
  function check(valid, message, field) {
    if (!valid) issues.push({ severity: 'error', message, field })
  }
  const positive = { fillTime: 'Fill time', fillFactor: 'Fill factor', looseDensity: 'Loose density',
    speedLoaded: 'Loaded speed', speedEmpty: 'Empty speed', shiftHours: 'Shift length',
    dutyBlockMinutes: 'Duty block length', inSituDensity: 'In-situ density' }
  const nonnegative = { distance: 'Tram distance', dumpTime: 'Dump time', positioningTime: 'Positioning time',
    handoverMinutes: 'Handover time', clearMinutes: 'Clearing time', blockMinutes: 'Block time',
    relocationMinutes: 'Relocation time', fillCV: 'Fill time CV', tripCV: 'Trip time CV',
    explosivePrice: 'Explosive price', oversizeSize: 'Oversize size', oversizeFactor: 'Oversize multiplier' }
  for (const [key, name] of Object.entries(positive)) {
    check(Number.isFinite(p[key]) && p[key] > 0, name + ' must be greater than zero.', key)
  }
  for (const [key, name] of Object.entries(nonnegative)) {
    check(Number.isFinite(p[key]) && p[key] >= 0, name + ' must be zero or greater.', key)
  }
  for (const [key, max] of [['dutyShare', 1], ['rockbreakerShare', 1], ['hangUpsPer100', 100], ['oversizePercent', 100]]) {
    if (key === 'oversizePercent' && p[key] == null) continue
    check(Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= max, key + ' must be between 0 and ' + max + '.', key)
  }
  check(Number.isFinite(p.K_kg_per_m3) && p.K_kg_per_m3 >= 0, 'Powder factor must be zero or greater.', 'K_kg_per_m3')
  check(Number.isFinite(p.valuePerTonne), 'Value per tonne must be a finite number.', 'valuePerTonne')
  check(p.x80 === null || (Number.isFinite(p.x80) && p.x80 >= p.x50), 'X80 must be at least X50.', 'x80')
  for (const key of ['drawpoints', 'shifts']) {
    check(Number.isSafeInteger(p[key]) && p[key] > 0, 'The number of ' + key + ' must be a positive integer.', key)
  }
  const alwaysBreaks = p.hangUpsPer100 === 100 && p.rockbreakerShare === 1
  const canSpendTimeRelocating = p.drawpoints > 1 && p.relocationMinutes > 0
  check(!(alwaysBreaks && p.clearMinutes === 0 && p.blockMinutes === 0 && !canSpendTimeRelocating),
    'Certain rockbreaker events need a nonzero clearing, block or usable relocation time.', 'clearMinutes')
  if (1000 * p.looseDensity > p.maxDensityKgM3) issues.push({
    field: 'looseDensity', severity: 'warning', message: 'Loose density exceeds the selected bucket’s maximum material density of ' +
      p.maxDensityKgM3 + ' kg/m³.'
  })
  return issues
}
