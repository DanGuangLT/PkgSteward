import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { executePluginUninstall } from "@/lib/api/settings/settings"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    executePluginUninstall(
      await readJsonBody<{
        previewId: string
        confirm: boolean
      }>(request)
    )
  )
}
