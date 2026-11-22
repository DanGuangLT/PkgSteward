import { respondWithEnvelope } from "@/lib/api/route-response"
import { getPluginsCatalog } from "@/lib/api/settings/settings"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => getPluginsCatalog(request.signal))
}
