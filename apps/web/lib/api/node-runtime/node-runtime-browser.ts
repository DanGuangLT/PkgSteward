import { nodeRuntimePaths } from "./node-runtime-paths.ts"
import { requestApi } from "../request.ts"
import { unwrapApiData } from "../response.ts"
import type {
  NodeRuntimeOverview,
  ProjectNodeRuntimeDetail,
} from "../../node-runtime/node-runtime-types.ts"

export async function getBrowserNodeRuntimeOverview(
  refresh = false,
  signal?: AbortSignal,
): Promise<NodeRuntimeOverview> {
  return unwrapApiData(
    await requestApi<NodeRuntimeOverview>(
      `/api${nodeRuntimePaths.overview(refresh)}`,
      { method: "GET", signal },
    ),
  )
}

export async function getBrowserProjectNodeRuntime(
  path: string,
  signal?: AbortSignal,
): Promise<ProjectNodeRuntimeDetail> {
  return unwrapApiData(
    await requestApi<ProjectNodeRuntimeDetail>(
      `/api${nodeRuntimePaths.project(path)}`,
      { method: "GET", signal },
    ),
  )
}
