import { cancelDiskUsage } from "@/lib/api/disk-usage/disk-usage"
import { toApiErrorResponse } from "@/lib/api/response"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const envelope = await cancelDiskUsage(id)
    return Response.json(envelope, { status: envelope.statusCode })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status })
  }
}
