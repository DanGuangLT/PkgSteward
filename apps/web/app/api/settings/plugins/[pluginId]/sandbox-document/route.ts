import { ApiError } from "@/lib/api/response"
import { respondWithEnvelope } from "@/lib/api/route-response"
import { getPluginSandboxDocument } from "@/lib/api/settings/settings"
import { PLUGIN_ID_REGEX } from "@/lib/settings/types"

export async function GET(
  request: Request,
  context: { params: Promise<{ pluginId: string }> }
): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const { pluginId } = await context.params
    if (!PLUGIN_ID_REGEX.test(pluginId)) {
      throw new ApiError(400, "Invalid plugin identifier", "VALIDATION_ERROR")
    }
    return getPluginSandboxDocument(pluginId)
  })
}
