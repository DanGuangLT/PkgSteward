import { getProjectAnalysis } from "@/lib/api/projects/projects"
import { toApiErrorResponse } from "@/lib/api/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const headers = { "Cache-Control": "no-store" }
  try {
    const { id } = await params
    const envelope = await getProjectAnalysis(id)
    return Response.json(envelope, { status: envelope.statusCode, headers })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status, headers })
  }
}
