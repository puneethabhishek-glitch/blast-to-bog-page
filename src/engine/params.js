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

const tariq = 'https://doi.org/10.1080/17480930.2025.2496911'
const tampier = 'https://doi.org/10.3390/app11188718'
const calibrated = (value, unit, source, sourceUrl) => ({ value, unit, label: 'C', source, sourceUrl })
const anchorSource = 'Assumed starting values. The main question for site engineers.'

export const anchorDefaults = {
  Fine: {
    x50: assumed(15, 'cm', anchorSource),
    fillTime: assumed(35, 's', anchorSource),
    fillFactor: assumed(0.95, 'fraction', anchorSource),
    hangUpsPer100: assumed(0.5, 'events/100 buckets', anchorSource)
  },
  Normal: {
    x50: assumed(25, 'cm', anchorSource),
    fillTime: calibrated(41, 's', 'Tariq et al. (2025), 21 t semi-autonomous LHDs at Kiirunavaara. Measured median loading duration 50 s from takeover to re-activation. A 41 s mean fill plus the 10 s takeover gives a modelled median of 50 s.', tariq),
    fillFactor: calibrated(0.90, 'fraction', 'Tampier et al. (2021), autonomous loading reached about 90% fill.', tampier),
    hangUpsPer100: assumed(1.0, 'events/100 buckets', anchorSource)
  },
  Coarse: {
    x50: assumed(40, 'cm', anchorSource),
    fillTime: calibrated(64, 's', 'Normal x 1.56. Cottee (2001) open pit analogue, where finer blasting cut dig time by 36%.'),
    fillFactor: calibrated(0.82, 'fraction', 'Normal / 1.10. Cottee (2001) open pit analogue, where finer blasting raised payload by 10%.'),
    hangUpsPer100: assumed(3.0, 'events/100 buckets', anchorSource)
  }
}

export const anchorTable = Object.entries(anchorDefaults).map(([name, cells]) => ({
  name, ...Object.fromEntries(Object.entries(cells).map(([key, cell]) => [key, cell.value]))
}))

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
  dumpTime: verified(machine.dumpTime, 's', machineSource + ' Hydraulic bucket tip only.'),
  dumpManoeuvreSeconds: assumed(10, 's', 'Assumed time to raise the bucket, settle at the tip and lower the bucket, besides the hydraulic tip. Not measured.'),
  looseDensity: assumed(2, 't/m³', 'Typical blasted gold ore, site input.'),
  speedLoaded: assumed(10, 'km/h', 'Assumed below the LH621i third gear speed.'),
  speedEmpty: assumed(12, 'km/h', 'Assumed below the LH621i third gear speed.'),
  distance: assumed(150, 'm'), positioningTime: assumed(30, 's', 'Assumed time to slow down and line up at the brow before the operator takes over.'),
  fragmentationMode: assumed('direct', 'mode', 'Choose a loading class, a measured size or the rough guide.'),
  table: assumed(anchorTable, 'cm, s, fraction, events/100 buckets', 'See the source for each anchor cell.'),
  x50: anchorDefaults.Normal.x50,
  x80: assumed(null, 'cm', 'Optional measured 80% passing size.'),
  fillTime: anchorDefaults.Normal.fillTime,
  fillFactor: anchorDefaults.Normal.fillFactor,
  hangUpsPer100: anchorDefaults.Normal.hangUpsPer100,
  fillDistribution: calibrated('lognormal', 'distribution', 'Tariq et al. (2025) recommend a lognormal for loading duration.', tariq),
  useOversize: assumed(false, 'on/off', 'Optional rate based on the percentage of oversize rock.'),
  oversizePercent: assumed(null, '%', 'Measured retained percentage, or derived in Kuz-Ram mode.'),
  oversizeFactor: assumed(1, 'events/100 buckets per percentage point', 'Editable unit multiplier.'),
  oversizeSize: assumed(0.8, 'm'),
  A: assumed(8, 'rock factor', kuzSource), K_kg_per_m3: assumed(0.8, 'kg/m³', 'Assumed. Use your own blast design.'),
  Q_kg: assumed(60, 'kg', 'Assumed. About 12 m of ANFO in an 89 mm hole, which gives 0.80 kg/m³ over 2 m × 2.5 m × 15 m.'), RWS: assumed(100, '% of ANFO strength', kuzSource),
  B_m: assumed(2, 'm', kuzSource), S_m: assumed(2.5, 'm', kuzSource),
  D_mm: assumed(89, 'mm', kuzSource), W_m: assumed(0.2, 'm', kuzSource),
  L_m: assumed(12, 'm', kuzSource), H_m: assumed(15, 'm', kuzSource),
  takeoverSeconds: { ...assumed(10, 's', 'Assumed share of the measured loading duration. Tariq et al. (2025) report takeover, filling and re-activation together.'), sourceUrl: tariq },
  trafficModel: assumed(true, 'on/off', 'Single lane drive. Loaded loaders have right of way. Passing only at brow junctions.'),
  minGapMetres: assumed(20, 'm', 'Minimum separation on a shared drive segment or crosscut.'),
  resetPriority: assumed(true, 'on/off', 'Assumed. Operators usually clear a stopped machine before the next fill.'),
  autoStopsPerHour: assumed(0.5, 'stops/trip hour', 'Assumed. Safety scanner stops, path faults and similar.'),
  autoStopResetMinutes: assumed(2, 'min'),
  clearMinutes: assumed(4, 'min'),
  secondaryEntryMinutes: assumed(30, 'min', 'Assumed time the level is isolated while a crew charges a hung-up brow for a secondary blast. All loaders on the level stop.'),
  secondaryWholeLevel: assumed(true, 'on/off', 'Assumed. On: a secondary blast isolates the whole level, because the crew reaches the brow along the shared drive. Off: only the hung-up crosscut is barricaded and the other loaders keep working.'),
  firingWindows: assumed(true, 'on/off', 'Assumed. Secondary blasts are fired at crib or at shift end, then the brow reopens after re-entry. Off uses the fixed brow block time.'),
  reEntryMinutes: assumed(30, 'min', 'Assumed wait after firing before the brow can be worked again.'),
  manualStopShare: assumed(0.10, 'fraction', 'Assumed share of auto-stops that need someone to go in, such as rock on the drive. The level is isolated first.'),
  manualEntryMinutes: assumed(30, 'min', 'Assumed time the level is isolated for a manual recovery.'), rockbreakerShare: assumed(0.30, 'fraction', 'Assumed share of hang-ups that need secondary breaking, usually a secondary blast in longhole stopes. The brow closes for the block time.'),
  blockMinutes: assumed(30, 'min'), relocationMinutes: assumed(5, 'min'),
  shiftHours: assumed(12, 'h', 'Assumed shift length based on a common WA roster.'),
  handoverMinutes: assumed(15, 'min'), dutyShare: assumed(0.10, 'fraction'),
  cribMinutes: assumed(30, 'min', 'Assumed one crib break at mid shift with no relief operator. Set 0 if a relief operator covers crib.'),
  operatorCeiling: assumed(0.90, 'fraction', 'Assumed planning ceiling for the share of working time the operator is busy. Above it queues grow fast and there is no slack for upsets.'),
  dutyBlockMinutes: assumed(3, 'min', 'Assumed duration of each other-duty job.'),
  fillCV: assumed(0.20, 'CV', variability), tripCV: assumed(0.10, 'CV', variability),
  drawpoints: assumed(4, 'brows', 'One open brow per loader up to the largest fleet compared.'), shifts: assumed(500, 'shifts'),
  explosivePrice: assumed(1.50, '$/kg', 'Assumed price, no public WA price.'),
  inSituDensity: assumed(2.8, 't/m³')
}

const values = Object.fromEntries(Object.entries(defaults).map(([key, entry]) => [key, entry.value]))

export const comparisonDefaults = {
  scenarios: [{ preset: 'Normal', powderFactor: defaults.K_kg_per_m3.value }, { preset: 'Coarse', powderFactor: 0.60 }],
  counts: [1, 2, 3, 4], costCount: assumed(3, 'loaders', 'Selected fleet for the cost comparison.'),
  replayCount: assumed(4, 'loaders', 'Selected fleet for the shift replay. One loader per open brow.'), seed: 24
}

/** Resolve raw overrides. Model/bucket selection and anchors supply dependent defaults. */
export function createParams(overrides = {}) {
  const p = { ...values, ...overrides }
  p.resetPriority = overrides.resetPriority ?? p.trafficModel
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
  for (const key of ['trafficModel', 'resetPriority', 'firingWindows', 'secondaryWholeLevel']) check(typeof p[key] === 'boolean', 'Choose on or off.', key)
  const positive = { minGapMetres: 'Traffic separation', fillTime: 'Fill time', fillFactor: 'Fill factor', looseDensity: 'Loose density',
    speedLoaded: 'Loaded speed', speedEmpty: 'Empty speed', shiftHours: 'Shift length',
    dutyBlockMinutes: 'Duty block length', inSituDensity: 'In-situ density' }
  const nonnegative = { takeoverSeconds: 'Takeover time', autoStopsPerHour: 'Auto-stop rate', autoStopResetMinutes: 'Reset time',
    distance: 'Tram distance', dumpTime: 'Bucket tip time', dumpManoeuvreSeconds: 'Dump raise and lower time', positioningTime: 'Positioning time',
    handoverMinutes: 'Handover time', cribMinutes: 'Crib break', secondaryEntryMinutes: 'Secondary blast entry time', reEntryMinutes: 'Re-entry time', manualEntryMinutes: 'Manual entry time', clearMinutes: 'Clearing time', blockMinutes: 'Block time',
    relocationMinutes: 'Relocation time', fillCV: 'Fill time CV', tripCV: 'Trip time CV',
    explosivePrice: 'Explosive price', oversizeSize: 'Oversize size', oversizeFactor: 'Oversize multiplier' }
  for (const [key, name] of Object.entries(positive)) {
    check(Number.isFinite(p[key]) && p[key] > 0, name + ' must be greater than zero.', key)
  }
  for (const [key, name] of Object.entries(nonnegative)) {
    check(Number.isFinite(p[key]) && p[key] >= 0, name + ' must be zero or greater.', key)
  }
  for (const [key, max] of [['dutyShare', 1], ['operatorCeiling', 1], ['manualStopShare', 1], ['rockbreakerShare', 1], ['hangUpsPer100', 100], ['oversizePercent', 100]]) {
    if (key === 'oversizePercent' && p[key] == null) continue
    check(Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= max, key + ' must be between 0 and ' + max + '.', key)
  }
  check(Number.isFinite(p.K_kg_per_m3) && p.K_kg_per_m3 >= 0, 'Powder factor must be zero or greater.', 'K_kg_per_m3')

  check(p.x80 === null || (Number.isFinite(p.x80) && p.x80 >= p.x50), 'X80 must be at least X50.', 'x80')
  for (const key of ['drawpoints', 'shifts']) {
    check(Number.isSafeInteger(p[key]) && p[key] > 0, 'The number of ' + (key === 'drawpoints' ? 'brows' : key) + ' must be a positive integer.', key)
  }
  const alwaysBreaks = p.hangUpsPer100 === 100 && p.rockbreakerShare === 1
  const canSpendTimeRelocating = p.drawpoints > 1 && p.relocationMinutes > 0
  check(!(alwaysBreaks && p.takeoverSeconds === 0 && p.clearMinutes === 0 && p.blockMinutes === 0 && !canSpendTimeRelocating),
    'Certain rockbreaker events need a nonzero takeover, clearing, block or usable relocation time.', 'clearMinutes')
  if (1000 * p.looseDensity > p.maxDensityKgM3) issues.push({
    field: 'looseDensity', severity: 'warning', message: 'Loose density exceeds the selected bucket’s maximum material density of ' +
      p.maxDensityKgM3 + ' kg/m³.'
  })
  if (p.fragmentationMode === 'kuzRam' && p.B_m > 0 && p.S_m > 0 && p.H_m > 0 && p.Q_kg > 0) {
    const implied = p.Q_kg / (p.B_m * p.S_m * p.H_m)
    if (Math.abs(implied - p.K_kg_per_m3) > 0.25 * p.K_kg_per_m3) issues.push({ field: 'K_kg_per_m3', severity: 'warning',
      message: 'Explosive per hole over burden × spacing × height gives ' + implied.toFixed(2) + ' kg/m³, which does not match this powder factor.' })
  }
  return issues
}
