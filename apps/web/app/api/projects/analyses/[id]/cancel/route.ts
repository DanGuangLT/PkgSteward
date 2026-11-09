import { cancelProjectAnalysis } from "@/lib/api/projects/projects"
import { toApiErrorResponse } from "@/lib/api/response"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params
    const envelope = await cancelProjectAnalysis(id)
    return Response.json(envelope, { status: envelope.statusCode })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status })
  }
}
