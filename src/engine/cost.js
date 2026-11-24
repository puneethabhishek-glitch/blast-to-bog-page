/** results is [mean tonnes for blast 1, mean tonnes for blast 2] at the same N. */
export function costCheck(blast1, blast2, results, { inSituDensity, explosivePrice, valuePerTonne }) {
  const costs = [blast1, blast2].map(blast => blast.K_kg_per_m3 / inSituDensity * explosivePrice)
  const high = blast2.K_kg_per_m3 > blast1.K_kg_per_m3 ? 1 : 0
  const low = 1 - high
  const extraCostPerTonne = costs[high] - costs[low]
  const extraTonnes = results[high] - results[low]
  const extraExplosiveCost = extraCostPerTonne * results[high]
  const netValue = extraTonnes * valuePerTonne - extraExplosiveCost
  return { costs, extraCostPerTonne, extraTonnes, extraExplosiveCost, netValue, paysBack: netValue > 0 }
}
