import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { executeSettingsUpdate, getSettings } from "@/lib/api/settings/settings"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => getSettings(request.signal))
}

export async function PATCH(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    executeSettingsUpdate(
      await readJsonBody<{
        previewId: string
        confirm: boolean
        acknowledgedRisks?: string[]
      }>(request)
    )
  )
}
