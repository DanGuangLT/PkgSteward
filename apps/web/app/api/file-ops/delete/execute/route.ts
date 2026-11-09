import { executeDelete } from "@/lib/api/file-ops/file-ops"
import { readJsonBody, respondWithEnvelope } from "@/lib/api/route-response"
import type { FileOpsExecuteInput } from "@/lib/api/types"

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => executeDelete(await readJsonBody<FileOpsExecuteInput>(request)))
}
