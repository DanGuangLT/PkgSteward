import { getPmJob } from "@/lib/api/package-managers/package-managers"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => getPmJob((await params).id, request.signal))
}
