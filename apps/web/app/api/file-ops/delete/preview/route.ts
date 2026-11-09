import { startDeletePreview } from "@/lib/api/file-ops/file-ops"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startDeletePreview(await readJsonBody<{ paths: string[] }>(request)))
}
