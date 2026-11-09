import { startPmVersions } from "@/lib/api/package-managers"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { PmVersionsRequest } from "@/lib/package-managers/pm-types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startPmVersions(await readJsonBody<PmVersionsRequest>(request)))
}
