import { getProjectDetail } from "@/lib/api/projects"
import { ApiError, toApiErrorResponse } from "@/lib/api/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" }
  try {
    const query = new URL(request.url).searchParams
    const paths = query.getAll("path")
    if (paths.length !== 1 || !paths[0] || [...query.keys()].some(key => key !== "path")) {
      throw new ApiError(400, "A single project path is required.", "VALIDATION_ERROR")
    }
    const envelope = await getProjectDetail(paths[0])
    return Response.json(envelope, { status: envelope.statusCode, headers })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status, headers })
  }
}
