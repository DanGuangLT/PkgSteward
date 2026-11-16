import { getNpmRunTerminalOutput } from "@/lib/api/npm-runs/npm-runs"
import { respondWithEnvelope } from "@/lib/api/route-response"
import { ApiError } from "@/lib/api/response"

export const dynamic = "force-dynamic"

function parseSafeInt(raw: string | null, min: number): number | null {
  if (raw === null || !/^(?:0|[1-9]\d*)$/.test(raw)) return null
  const num = Number(raw)
  return Number.isSafeInteger(num) && num >= min ? num : null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const query = new URL(request.url).searchParams
    if (
      query.getAll("generation").length !== 1
      || query.getAll("cursor").length > 1
      || [...query.keys()].some((key) => key !== "generation" && key !== "cursor")
    ) {
      throw new ApiError(400, "Invalid terminal output query.", "VALIDATION_ERROR")
    }
    const generation = parseSafeInt(query.get("generation"), 1)
    const cursor = parseSafeInt(query.get("cursor") ?? "0", 0)
    if (generation === null || cursor === null) {
      throw new ApiError(400, "Invalid terminal output generation or cursor.", "VALIDATION_ERROR")
    }
    return getNpmRunTerminalOutput((await params).id, generation, cursor, request.signal)
  })
}
