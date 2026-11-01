import { getOperation } from "@/lib/api/file-ops"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respondWithEnvelope(request, async () => getOperation((await params).id))
}
