import type { GlobalManagerInventory } from "@/lib/global-packages/global-types"

export interface GlobalManagerMetrics {
  totalCount: number
  manageableCount: number
  protectedOrLinkedCount: number
  invalidCount: number
  available: boolean
  version: string | null
}

export function computeGlobalManagerMetrics(inventory: GlobalManagerInventory): GlobalManagerMetrics {
  let manageableCount = 0
  let protectedOrLinkedCount = 0
  let invalidCount = 0

  for (const pkg of inventory.packages) {
    if (pkg.status === "manageable" && pkg.reason === null) {
      manageableCount += 1
    } else if (pkg.status === "protected" || pkg.status === "linked") {
      protectedOrLinkedCount += 1
    } else {
      invalidCount += 1
    }
  }

  return {
    totalCount: inventory.packages.length,
    manageableCount,
    protectedOrLinkedCount,
    invalidCount,
    available: inventory.available,
    version: inventory.version,
  }
}
