import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import { previewSettingsImport } from "@/lib/api/settings/settings"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const body = await readJsonBody<{ document: Record<string, unknown> }>(request)
    return previewSettingsImport(body.document)
  })
}
