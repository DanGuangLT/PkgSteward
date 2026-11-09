import { cancelGlobalJob } from "@/lib/api/global-packages/global-packages"
import { respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => cancelGlobalJob((await params).id))
}
