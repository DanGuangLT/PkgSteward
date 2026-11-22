import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { previewSettingsReset } from "@/lib/api/settings/settings"
import type { SettingsResetScope } from "@/lib/settings/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const body = await readJsonBody<{ scope: SettingsResetScope }>(request)
    return previewSettingsReset(body.scope)
  })
}
