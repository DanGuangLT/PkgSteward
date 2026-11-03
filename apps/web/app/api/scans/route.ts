import { toApiErrorResponse } from "@/lib/api/response"
import { startScan } from "@/lib/api/scans"

export async function POST(request: Request): Promise<Response> {
  try {
    const envelope = await startScan()
    return Response.json(envelope, { status: envelope.statusCode })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status })
  }
}
