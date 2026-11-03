import { toApiErrorResponse } from "@/lib/api/response"
import { getScan } from "@/lib/api/scans"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const envelope = await getScan(id)
    return Response.json(envelope, {
      status: envelope.statusCode,
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
  }
}
