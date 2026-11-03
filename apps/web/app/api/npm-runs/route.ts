import { startNpmRun } from "@/lib/api/npm-runs"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { RunRequest } from "@/lib/api/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => startNpmRun(await readJsonBody<RunRequest>(request)))
}
