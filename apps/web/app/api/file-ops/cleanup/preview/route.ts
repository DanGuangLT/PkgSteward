import { startCleanupPreview } from "@/lib/api/file-ops"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { CleanupPreviewInput } from "@/lib/api/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startCleanupPreview(await readJsonBody<CleanupPreviewInput>(request)))
}
