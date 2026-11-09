import { getGlobalLogs } from "@/lib/api/global-packages/global-packages"
import { respondWithEnvelope } from "@/lib/api/route-response"
import { ApiError } from "@/lib/api/response"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const query = new URL(request.url).searchParams
    const cursor = query.get("cursor") ?? "0"
    if (query.getAll("cursor").length > 1 || [...query.keys()].some(key => key !== "cursor")
      || !/^(?:0|[1-9]\d*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      throw new ApiError(400, "Invalid log cursor.", "VALIDATION_ERROR")
    }
    return getGlobalLogs((await params).id, Number(cursor), request.signal)
  })
}
