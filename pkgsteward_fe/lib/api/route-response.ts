import { ApiError, toApiErrorResponse } from "./response.ts"
import type { ApiResponse } from "./types"

const NO_STORE = { "Cache-Control": "no-store" }

export async function respondWithEnvelope<T>(
  request: Request,
  call: () => Promise<ApiResponse<T>>
): Promise<Response> {
  try {
    const envelope = await call()
    return Response.json(envelope, { status: envelope.statusCode, headers: NO_STORE })
  } catch (error) {
    const { body, status } = toApiErrorResponse(error, new URL(request.url).pathname)
    return Response.json(body, { status, headers: NO_STORE })
  }
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, "The request body must be valid JSON.", "VALIDATION_ERROR")
  }
}
