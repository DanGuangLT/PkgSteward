import { respondWithEnvelope } from "@/lib/api/route-response"
import { exportSettings } from "@/lib/api/settings/settings"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => exportSettings(request.signal))
}
