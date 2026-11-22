import { ApiError } from "@/lib/api/response"
import { respondWithEnvelope, readJsonBody } from "@/lib/api/route-response"
import { previewPluginInstallBinary, previewPluginInstallJson } from "@/lib/api/settings/settings"

const MAX_BINARY_UPLOAD_BYTES = 25 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  return respondWithEnvelope(request, async () => {
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/octet-stream")) {
      const contentLen = Number(request.headers.get("content-length"))
      if (Number.isFinite(contentLen) && contentLen > MAX_BINARY_UPLOAD_BYTES) {
        throw new ApiError(413, "Plugin binary package exceeds 25 MB limit", "PAYLOAD_TOO_LARGE")
      }
      const fileNameHeader = request.headers.get("x-plugin-filename") ?? ""
      const bytes = await request.arrayBuffer()
      if (bytes.byteLength > MAX_BINARY_UPLOAD_BYTES) {
        throw new ApiError(413, "Plugin binary package exceeds 25 MB limit", "PAYLOAD_TOO_LARGE")
      }
      return previewPluginInstallBinary(fileNameHeader, bytes)
    }
    return previewPluginInstallJson(
      await readJsonBody<{ url?: string; fileName?: string; contentBase64?: string }>(request)
    )
  })
}
