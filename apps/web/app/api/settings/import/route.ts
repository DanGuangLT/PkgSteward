import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { executeSettingsImport } from "@/lib/api/settings/settings"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    executeSettingsImport(
      await readJsonBody<{
        previewId: string
        confirm: boolean
        acknowledgedRisks?: string[]
      }>(request)
    )
  )
}
