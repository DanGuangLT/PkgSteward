import { getProjectNodeRuntime } from "@/lib/api/node-runtime/node-runtime"
import { ApiError } from "@/lib/api/response"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, () => {
    const query = new URL(request.url).searchParams
    const paths = query.getAll("path")
    if (paths.length !== 1 || !paths[0] || [...query.keys()].some((key) => key !== "path")) {
      throw new ApiError(400, "A single project path is required.", "VALIDATION_ERROR")
    }
    return getProjectNodeRuntime(paths[0], request.signal)
  })
}
