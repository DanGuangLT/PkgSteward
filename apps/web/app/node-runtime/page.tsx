import { getTranslations } from "next-intl/server"

import {
  NodeRuntimePanel,
  type InitialNodeRuntime,
} from "@/components/features/node-runtime/node-runtime-panel"
import { Container } from "@/components/layout/container"
import { getNodeRuntimeOverview } from "@/lib/api/node-runtime/node-runtime"
import { ApiError, unwrapApiData } from "@/lib/api/response"

async function getInitialNodeRuntime(): Promise<InitialNodeRuntime> {
  try {
    const overview = unwrapApiData(await getNodeRuntimeOverview())
    return { kind: "ready", overview }
  } catch (error) {
    return {
      kind: "error",
      code:
        error instanceof ApiError
          ? error.code ?? "INTERNAL_SERVER_ERROR"
          : "INTERNAL_SERVER_ERROR",
    }
  }
}

export default async function NodeRuntimePage() {
  const [t, initial] = await Promise.all([
    getTranslations("nodeRuntime"),
    getInitialNodeRuntime(),
  ])

  return (
    <Container className="flex min-w-0 flex-1 flex-col gap-8 py-8 md:py-12 lg:py-16">
      <h1 className="text-heading-xl">{t("title")}</h1>
      <NodeRuntimePanel initial={initial} />
    </Container>
  )
}
