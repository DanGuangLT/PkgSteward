import "server-only"

import { apiFetchEnvelope } from "../client.ts"
import { nodeRuntimePaths } from "./node-runtime-paths.ts"
import type { ApiResponse } from "@/lib/api/types"
import type {
  NodeRuntimeOverview,
  ProjectNodeRuntimeDetail,
} from "@/lib/node-runtime/node-runtime-types"

export async function getNodeRuntimeOverview(
  refresh = false,
  signal?: AbortSignal,
): Promise<ApiResponse<NodeRuntimeOverview>> {
  return apiFetchEnvelope<NodeRuntimeOverview>(
    nodeRuntimePaths.overview(refresh),
    { method: "GET", signal },
  )
}

export async function getProjectNodeRuntime(
  path: string,
  signal?: AbortSignal,
): Promise<ApiResponse<ProjectNodeRuntimeDetail>> {
  return apiFetchEnvelope<ProjectNodeRuntimeDetail>(
    nodeRuntimePaths.project(path),
    { method: "GET", signal },
  )
}
