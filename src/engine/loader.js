export function autonomousTime({ distance, speedLoaded, speedEmpty, dumpTime, positioningTime }) {
  return distance / (speedLoaded / 3.6) + distance / (speedEmpty / 3.6) + dumpTime + positioningTime
}

export function tonnesPerBucket(bucket, looseDensity, fillFactor, capacity) {
  const uncapped = bucket * looseDensity * fillFactor
  return { tonnes: Math.min(uncapped, capacity), uncapped, capped: uncapped > capacity }
}
