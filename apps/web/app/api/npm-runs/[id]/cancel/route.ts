import { cancelNpmRun } from "@/lib/api/npm-runs/npm-runs"
import { respondWithEnvelope } from "@/lib/api/route-response"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => cancelNpmRun((await params).id))
}
