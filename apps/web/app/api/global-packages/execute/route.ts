import { executeGlobalPackage } from "@/lib/api/global-packages/global-packages"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { GlobalExecuteRequest } from "@/lib/global-packages/global-types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => executeGlobalPackage(await readJsonBody<GlobalExecuteRequest>(request)))
}
