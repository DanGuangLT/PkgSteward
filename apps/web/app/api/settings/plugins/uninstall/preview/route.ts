import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { previewPluginUninstall } from "@/lib/api/settings/settings"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    previewPluginUninstall(await readJsonBody<{ pluginId: string }>(request))
  )
}
