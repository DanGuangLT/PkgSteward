import { startPmPreview } from "@/lib/api/package-managers/package-managers"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { PmPreviewRequest } from "@/lib/package-managers/pm-types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startPmPreview(await readJsonBody<PmPreviewRequest>(request)))
}
