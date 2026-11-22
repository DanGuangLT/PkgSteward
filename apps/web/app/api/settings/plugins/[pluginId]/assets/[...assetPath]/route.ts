import { apiFetchRawBinary } from "@/lib/api/client"
import { ApiError, toApiErrorResponse } from "@/lib/api/response"
import { pluginAssetPath } from "@/lib/api/settings/settings-paths"
import { PLUGIN_ID_REGEX } from "@/lib/settings/types"

function hasUnsafeAssetSegment(segment: string): boolean {
  return (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\\") ||
    segment.includes("\0") ||
    segment.includes(":")
  )
}

export async function GET(
  request: Request,
  context: { params: Promise<{ pluginId: string; assetPath: string[] }> }
): Promise<Response> {
  try {
    const { pluginId, assetPath } = await context.params
    if (!PLUGIN_ID_REGEX.test(pluginId)) {
      throw new ApiError(400, "Invalid plugin identifier", "VALIDATION_ERROR")
    }
    if (!Array.isArray(assetPath) || assetPath.length === 0 || assetPath.some(hasUnsafeAssetSegment)) {
      throw new ApiError(400, "Invalid plugin asset path", "VALIDATION_ERROR")
    }

    const upstream = await apiFetchRawBinary(pluginAssetPath(pluginId, assetPath.join("/")))
    if (!upstream.ok) {
      const errorPayload = await upstream.json().catch(() => null)
      const message =
        errorPayload && typeof errorPayload.message === "string"
          ? errorPayload.message
          : "Failed to load plugin asset"
      const code =
        errorPayload && typeof errorPayload.code === "string"
          ? errorPayload.code
          : "HTTP_EXCEPTION"
      const { body, status } = toApiErrorResponse(
        new ApiError(upstream.status, message, code),
        request.url
      )
      return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
    }

    const headers = new Headers()
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream")
    headers.set("X-Content-Type-Options", "nosniff")
    headers.set("Cache-Control", "no-store")
    const csp = upstream.headers.get("content-security-policy")
    if (csp) {
      headers.set("Content-Security-Policy", csp)
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (error) {
    const wrapped =
      error instanceof ApiError
        ? error
        : new ApiError(503, "The backend is unavailable.", "BACKEND_UNAVAILABLE")
    const { body, status } = toApiErrorResponse(wrapped, request.url)
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
  }
}
