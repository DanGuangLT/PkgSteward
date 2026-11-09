import { getNpmRun } from "@/lib/api/npm-runs/npm-runs"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => getNpmRun((await params).id, request.signal))
}
