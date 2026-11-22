import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { updatePreferences } from "@/lib/api/settings/settings"
import type { PreferencesPatch } from "@/lib/settings/types"

export async function PATCH(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    updatePreferences(await readJsonBody<PreferencesPatch>(request))
  )
}
