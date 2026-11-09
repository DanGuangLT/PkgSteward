import { getPmContext } from "@/lib/api/package-managers/package-managers"
import { respondWithEnvelope } from "@/lib/api/route-response"
import { ApiError } from "@/lib/api/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const query = new URL(request.url).searchParams
    const paths = query.getAll("path")
    if (paths.length !== 1 || !paths[0] || [...query.keys()].some(key => key !== "path")) {
      throw new ApiError(400, "A single project path is required.", "VALIDATION_ERROR")
    }
    return getPmContext(paths[0], request.signal)
  })
}
