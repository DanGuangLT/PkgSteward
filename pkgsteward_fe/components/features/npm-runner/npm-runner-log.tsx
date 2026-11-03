"use client"

import { Component, createRef } from "react"
import { useFormatter, useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { isNearLogBottom, shouldAutoscroll } from "@/lib/npm-runner/runner-log-view"
import type { RunnerLogs } from "@/lib/npm-runner/runner-log-view"

interface LogViewportProps {
  logs: RunnerLogs
  labels: { title: string; stdout: string; stderr: string; empty: string; jump: string; paused: string }
}

// React's snapshot lifecycle reads the old DOM before a new log page is committed.
class LogViewport extends Component<LogViewportProps, { following: boolean }, boolean> {
  state = { following: true }
  viewport = createRef<HTMLDivElement>()

  componentDidMount() {
    const node = this.viewport.current
    if (node) node.scrollTop = node.scrollHeight
  }
  getSnapshotBeforeUpdate(): boolean {
    const node = this.viewport.current
    return node !== null && shouldAutoscroll(this.state.following, node)
  }
  componentDidUpdate(_previous: LogViewportProps, _state: { following: boolean }, follow: boolean) {
    const node = this.viewport.current
    if (follow && node) node.scrollTop = node.scrollHeight
  }
  render() {
    const { logs, labels } = this.props
    return <div className="min-w-0 space-y-3">
      <div ref={this.viewport} role="region" aria-label={labels.title} tabIndex={0}
        className="max-h-96 min-h-32 min-w-0 overflow-y-auto rounded-md border border-border bg-muted p-4 focus-ring"
        onScroll={event => {
          const following = isNearLogBottom(event.currentTarget)
          if (following !== this.state.following) this.setState({ following })
        }}>
        <pre className="min-w-0 whitespace-pre-wrap font-mono text-body-sm [overflow-wrap:anywhere]">{logs.chunks.length ? logs.chunks.map(chunk => (
          <span key={chunk.seq}><span className="font-semibold">[{labels[chunk.stream]}] </span>{chunk.text}</span>
        )) : labels.empty}</pre>
      </div>
      {!this.state.following ? <p className="text-body-sm text-muted-foreground">{labels.paused}</p> : null}
      <Button type="button" variant="secondary" className="h-auto min-h-10 whitespace-normal" onClick={() => {
        this.setState({ following: true })
        const node = this.viewport.current
        if (node) node.scrollTop = node.scrollHeight
      }}>{labels.jump}</Button>
    </div>
  }
}

export function NpmRunnerLog({ logs }: { logs: RunnerLogs }) {
  const t = useTranslations("npmRunner")
  const format = useFormatter()
  return <section className="min-w-0 space-y-3" aria-label={t("logs.title")}>
    <h3 className="text-heading-md">{t("logs.title")}</h3>
    {logs.droppedChunks > 0 || logs.localDroppedBytes > 0 || logs.serverDroppedBytes > 0 ? (
      <p className="text-body-sm">{t("logs.truncated", { count: logs.droppedChunks,
        chunks: format.number(logs.droppedChunks), localBytes: format.number(logs.localDroppedBytes),
        serverBytes: format.number(logs.serverDroppedBytes) })}</p>
    ) : null}
    <LogViewport key={logs.jobId ?? "empty"} logs={logs} labels={{ title: t("logs.title"), stdout: t("logs.stdout"),
      stderr: t("logs.stderr"), empty: t("logs.empty"), jump: t("jumpToLatest"), paused: t("logs.paused") }} />
  </section>
}
