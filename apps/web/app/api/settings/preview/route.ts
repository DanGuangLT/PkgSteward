import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { previewSettingsUpdate } from "@/lib/api/settings/settings"
import type { PrivilegedSettingsPatch } from "@/lib/settings/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () =>
    previewSettingsUpdate(await readJsonBody<PrivilegedSettingsPatch>(request))
  )
}
