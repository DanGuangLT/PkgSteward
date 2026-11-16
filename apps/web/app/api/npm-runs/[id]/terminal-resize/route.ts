import { resizeNpmRunTerminal } from "@/lib/api/npm-runs/npm-runs"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { TerminalResizeRequest } from "@/lib/api/types"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => resizeNpmRunTerminal((await params).id, await readJsonBody<TerminalResizeRequest>(request)))
}
