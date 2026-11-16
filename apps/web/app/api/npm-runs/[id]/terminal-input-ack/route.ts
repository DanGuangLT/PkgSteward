import { getNpmRunTerminalInputAck } from "@/lib/api/npm-runs/npm-runs"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { TerminalInputAckRequest } from "@/lib/api/types"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return respondWithEnvelope(request, async () => getNpmRunTerminalInputAck((await params).id, await readJsonBody<TerminalInputAckRequest>(request)))
}
