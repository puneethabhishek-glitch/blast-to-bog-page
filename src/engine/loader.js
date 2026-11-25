export function autonomousTime({ distance, speedLoaded, speedEmpty, dumpTime, dumpManoeuvreSeconds = 0, positioningTime }) {
  return distance / (speedLoaded / 3.6) + distance / (speedEmpty / 3.6) + dumpTime + dumpManoeuvreSeconds + positioningTime
}

export function tonnesPerBucket(bucket, looseDensity, fillFactor, capacity) {
  const uncapped = bucket * looseDensity * fillFactor
  return { tonnes: Math.min(uncapped, capacity), uncapped, capped: uncapped > capacity }
}
