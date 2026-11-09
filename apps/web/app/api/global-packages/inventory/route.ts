import { startGlobalInventory } from "@/lib/api/global-packages/global-packages"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { GlobalActivityRequest } from "@/lib/global-packages/global-types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startGlobalInventory(await readJsonBody<GlobalActivityRequest>(request)))
}
