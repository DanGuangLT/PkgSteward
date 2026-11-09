import { summarizePreview } from "@/lib/api/file-ops/file-ops"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respondWithEnvelope(request, async () => summarizePreview(
    (await params).id,
    await readJsonBody<{ paths: string[] }>(request)
  ))
}
