import { toApiErrorResponse } from "@/lib/api/response"
import { cancelScan } from "@/lib/api/scans"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const envelope = await cancelScan(id)
    return Response.json(envelope, { status: envelope.statusCode })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status })
  }
}
