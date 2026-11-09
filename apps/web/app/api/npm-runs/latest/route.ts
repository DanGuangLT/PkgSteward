import { getLatestNpmRun } from "@/lib/api/npm-runs/npm-runs"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => getLatestNpmRun(request.signal))
}
