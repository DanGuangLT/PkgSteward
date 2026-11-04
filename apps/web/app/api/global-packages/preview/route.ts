import { startGlobalPreview } from "@/lib/api/global-packages"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { GlobalPreviewRequest } from "@/lib/global-packages/global-types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startGlobalPreview(await readJsonBody<GlobalPreviewRequest>(request)))
}
