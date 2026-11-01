import { cancelPreview } from "@/lib/api/file-ops"
import { respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respondWithEnvelope(request, async () => cancelPreview((await params).id))
}
