import { cancelPmJob } from "@/lib/api/package-managers"
import { respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => cancelPmJob((await params).id))
}
