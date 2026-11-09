import { getActiveOperation } from "@/lib/api/file-ops/file-ops"
import { respondWithEnvelope } from "@/lib/api/route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return respondWithEnvelope(request, getActiveOperation)
}
