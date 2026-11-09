import { getGlobalJob } from "@/lib/api/global-packages/global-packages"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => getGlobalJob((await params).id, request.signal))
}
