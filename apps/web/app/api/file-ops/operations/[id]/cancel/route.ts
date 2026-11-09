import { cancelOperation } from "@/lib/api/file-ops/file-ops"
import { respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respondWithEnvelope(request, async () => cancelOperation((await params).id))
}
