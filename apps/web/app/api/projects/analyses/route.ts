import { startProjectAnalysis } from "@/lib/api/projects"
import { ApiError, toApiErrorResponse } from "@/lib/api/response"
import type { StartProjectAnalysis } from "@/lib/api/types"

export async function POST(request: Request): Promise<Response> {
  try {
    const input: StartProjectAnalysis = await request.json().catch(() => {
      throw new ApiError(400, "The request body must be valid JSON.", "VALIDATION_ERROR")
    })
    const envelope = await startProjectAnalysis(input)
    return Response.json(envelope, { status: envelope.statusCode })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status })
  }
}
