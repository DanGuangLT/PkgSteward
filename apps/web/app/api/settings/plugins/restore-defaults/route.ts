import { respondWithEnvelope } from "@/lib/api/route-response"
import { restoreDefaultPlugins } from "@/lib/api/settings/settings"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => restoreDefaultPlugins())
}
