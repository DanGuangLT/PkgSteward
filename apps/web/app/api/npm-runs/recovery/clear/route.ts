import { clearRecoveryHold } from "@/lib/api/npm-runs/npm-runs"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { RecoveryClearRequest } from "@/lib/api/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => clearRecoveryHold(await readJsonBody<RecoveryClearRequest>(request)))
}
