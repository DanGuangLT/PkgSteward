import { getGlobalSnapshot } from "@/lib/api/global-packages"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => getGlobalSnapshot(request.signal))
}
