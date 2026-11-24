import { getNodeRuntimeOverview } from "@/lib/api/node-runtime/node-runtime"
import { ApiError } from "@/lib/api/response"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => {
    const query = new URL(request.url).searchParams
    for (const key of query.keys()) {
      if (key !== "refresh") {
        throw new ApiError(400, "Unsupported query parameter.", "VALIDATION_ERROR")
      }
    }
    const refreshValues = query.getAll("refresh")
    if (refreshValues.length > 1) {
      throw new ApiError(400, "A single refresh flag is expected.", "VALIDATION_ERROR")
    }
    const rawRefresh = refreshValues[0]
    if (rawRefresh !== undefined && rawRefresh !== "true" && rawRefresh !== "false") {
      throw new ApiError(400, "refresh must be true or false.", "VALIDATION_ERROR")
    }
    return getNodeRuntimeOverview(rawRefresh === "true", request.signal)
  })
}
