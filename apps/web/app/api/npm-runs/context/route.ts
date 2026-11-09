import { getRunnerContext } from "@/lib/api/npm-runs/npm-runs"
import { respondWithEnvelope } from "@/lib/api/route-response"
import { ApiError } from "@/lib/api/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const query = new URL(request.url).searchParams
    if (query.getAll("path").length !== 1 || [...query.keys()].some(key => key !== "path")) {
      throw new ApiError(400, "A single path is required.", "VALIDATION_ERROR")
    }
    return getRunnerContext(query.get("path")!, request.signal)
  })
}
