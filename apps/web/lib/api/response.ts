import type { ApiResponse } from "@/lib/api/types"

export class ApiError extends Error {
  statusCode: number
  code?: string
  details?: unknown

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function invalidResponse(): ApiError {
  return new ApiError(502, "The backend returned an invalid response.", "INVALID_RESPONSE")
}

export async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw invalidResponse()
  }

  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    !("statusCode" in body) || typeof body.statusCode !== "number" ||
    !Number.isInteger(body.statusCode) || body.statusCode < 100 || body.statusCode > 599 ||
    body.statusCode !== response.status ||
    !("message" in body) || typeof body.message !== "string"
  ) {
    throw invalidResponse()
  }

  const envelope = body as ApiResponse<T>
  if (!response.ok) {
    throw new ApiError(envelope.statusCode, envelope.message, envelope.code, envelope.details)
  }
  return envelope
}

export function unwrapApiData<T>(response: ApiResponse<T>): T {
  if (response.data === undefined) throw invalidResponse()
  return response.data
}

export function toApiErrorResponse(
  error: unknown,
  path: string
): { body: ApiResponse<never>; status: number } {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, "An unexpected error occurred.", "INTERNAL_SERVER_ERROR")

  return {
    status: apiError.statusCode,
    body: {
      statusCode: apiError.statusCode,
      message: apiError.message,
      code: apiError.code ?? "HTTP_EXCEPTION",
      timestamp: new Date().toISOString(),
      path,
      ...(apiError.details !== undefined ? { details: apiError.details } : {}),
    },
  }
}
