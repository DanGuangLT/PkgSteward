"use client"

import "@xterm/xterm/css/xterm.css"

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SearchIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react"
import { useTranslations } from "next-intl"

import { NpmRunnerLog } from "@/components/features/npm-runner/npm-runner-log"
import { useRunnerDock } from "@/components/features/npm-runner/npm-runner-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useNavigationContinuity, useViewState } from "@/hooks/use-navigation-continuity"
import { isRunActive, runnerEligibility } from "@/lib/npm-runner/runner-policy"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"
import {
  findTerminalOutputMatches,
  isValidTerminalInputText,
  needsTerminalPasteConfirmation,
  resolveTerminalCtrlC,
  terminalOutputText,
  utf8ByteLength,
} from "@/lib/npm-runner/terminal-session"
import { appendReturnContext, createEnumCodec } from "@/lib/ui/navigation-targets"
import type messages from "@/messages/vi.json"

export const TERMINAL_DOCK_STATE_KEY = "npmRunner:terminalDock"
export const TERMINAL_DOCK_MODES = ["expanded", "collapsed"] as const
export type TerminalDockMode = (typeof TERMINAL_DOCK_MODES)[number]
export const terminalDockCodec = createEnumCodec<TerminalDockMode>(1, TERMINAL_DOCK_MODES)

interface XtermInstance {
  term: import("@xterm/xterm").Terminal
  fitAddon: import("@xterm/addon-fit").FitAddon
}

function readThemeVar(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(name).trim()
  return value || undefined
}

function buildTerminalTheme() {
  if (typeof document === "undefined") return undefined
  const style = getComputedStyle(document.documentElement)
  const background = readThemeVar(style, "--card") ?? readThemeVar(style, "--background")
  const foreground = readThemeVar(style, "--card-foreground") ?? readThemeVar(style, "--foreground")
  const cursor = readThemeVar(style, "--primary") ?? foreground
  const selectionBackground = readThemeVar(style, "--muted")
  const red = readThemeVar(style, "--destructive")
  const green = readThemeVar(style, "--success")
  const blue = readThemeVar(style, "--primary")
  const brightBlack = readThemeVar(style, "--muted-foreground")
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    selectionBackground,
    red,
    green,
    blue,
    brightBlack,
    white: foreground,
    brightWhite: foreground,
  }
}

export function TerminalDock() {
  const t = useTranslations("npmRunner")
  const tCommon = useTranslations("common")
  const dock = useRunnerDock()
  const { hydrated, currentUrl, entryId } = useNavigationContinuity()
  const [dockMode, setDockMode] = useViewState<TerminalDockMode>(
    TERMINAL_DOCK_STATE_KEY,
    terminalDockCodec,
    "expanded",
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [followOutput, setFollowOutput] = useState(true)
  const [commandInput, setCommandInput] = useState("")
  const [pendingPaste, setPendingPaste] = useState<string | null>(null)
  const [pasteRejectedTooLarge, setPasteRejectedTooLarge] = useState(false)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  const { state } = dock
  const job = state.job
  const { terminal } = state
  const expanded = dockMode === "expanded"

  const visible = state.phase !== "idle"
    || state.startUnknown
    || state.cancelUnknown
    || job !== null
    || terminal.output.chunks.length > 0
    || state.logs.chunks.length > 0

  const isPtyRun = Boolean(job?.terminal?.available)
  const canInteractiveWrite = Boolean(
    job
    && job.status === "running"
    && job.terminal?.available
    && job.terminal.ready
    && terminal.writer
    && !terminal.inputPending
    && !terminal.inputUnknown
    && !job.terminal.inputBlocked,
  )
  const display = runnerDisplay(state, { action: job?.action ?? "install_all" }, state.contextError)
  const canStop = display.canCancel
  const busy = Boolean(
    state.phase === "starting"
    || state.phase === "tracking"
    || state.startUnknown
    || state.cancelUnknown
    || (job && isRunActive(job)),
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<XtermInstance | null>(null)
  const writtenStateRef = useRef<{ jobId: string | null; generation: number; resetRevision: number; chunkCount: number }>({
    jobId: null,
    generation: -1,
    resetRevision: -1,
    chunkCount: 0,
  })
  const latestOutputRef = useRef(terminal.output)
  const followOutputRef = useRef(followOutput)
  const sendInputRef = useRef(dock.sendTerminalInput)
  const canWriteRef = useRef(canInteractiveWrite)
  const resizeRef = useRef(dock.resizeTerminal)

  useEffect(() => {
    latestOutputRef.current = terminal.output
    followOutputRef.current = followOutput
    sendInputRef.current = dock.sendTerminalInput
    canWriteRef.current = canInteractiveWrite
    resizeRef.current = dock.resizeTerminal
  }, [canInteractiveWrite, dock.resizeTerminal, dock.sendTerminalInput, followOutput, terminal.output])

  const plainOutputText = useMemo(() => terminalOutputText(terminal.output), [terminal.output])
  const searchResult = useMemo(
    () => findTerminalOutputMatches(plainOutputText, searchQuery),
    [plainOutputText, searchQuery],
  )
  const safeMatchIndex = searchResult.count > 0 ? Math.min(activeMatchIndex, searchResult.count - 1) : 0

  const queueOrSendPaste = useCallback((text: string) => {
    setPasteRejectedTooLarge(false)
    if (!text) return
    if (!isValidTerminalInputText(text)) {
      setPasteRejectedTooLarge(true)
      return
    }
    if (needsTerminalPasteConfirmation(text)) {
      setPendingPaste(text)
      return
    }
    void sendInputRef.current(text)
  }, [])

  // Auto-claim unassigned PTY writer lease when the user sees the running terminal.
  useEffect(() => {
    if (!visible || !expanded || !job || job.status !== "running") return
    const meta = job.terminal
    if (!meta?.available || !meta.ready) return
    if (meta.writerGeneration !== null || terminal.writer !== null) return
    if (terminal.claiming || terminal.claimError || terminal.inputUnknown || meta.inputBlocked) return
    void dock.claimTerminal(false)
  }, [
    dock,
    expanded,
    job,
    terminal.claimError,
    terminal.claiming,
    terminal.inputUnknown,
    terminal.writer,
    visible,
  ])

  // Client-only dynamic mount of xterm.js + FitAddon with parser/link/query hardening.
  useEffect(() => {
    if (!visible || !expanded || !isPtyRun) return
    const host = containerRef.current
    if (!host) return

    let disposed = false
    let observer: ResizeObserver | null = null
    let themeObserver: MutationObserver | null = null
    let cleanupPaste: (() => void) | null = null
    let localTerm: import("@xterm/xterm").Terminal | null = null

    async function mountXterm() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      if (disposed || !containerRef.current) return

      const term = new Terminal({
        convertEol: false,
        cursorBlink: false,
        disableStdin: false,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 13,
        scrollback: 5000,
        screenReaderMode: true,
        windowOptions: {},
        linkHandler: { activate: () => {} },
        theme: buildTerminalTheme(),
      })

      // Block silent parser queries and host mutations triggered by untrusted terminal output.
      for (const osc of [0, 1, 2, 10, 11, 12, 52]) {
        term.parser.registerOscHandler(osc, () => true)
      }
      for (const id of [
        { final: "n" },
        { prefix: "?", final: "n" },
        { final: "c" },
        { prefix: ">", final: "c" },
      ]) {
        term.parser.registerCsiHandler(id, () => true)
      }
      term.parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => true)

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      resizeRef.current(term.cols, term.rows)

      term.attachCustomKeyEventHandler(event => {
        if (event.type !== "keydown") return true
        const isCtrlC = (event.ctrlKey || event.metaKey)
          && !event.altKey
          && !event.shiftKey
          && event.key.toLowerCase() === "c"
        if (!isCtrlC) return true
        const policy = resolveTerminalCtrlC(term.hasSelection())
        if (policy === "copy") {
          const selected = term.getSelection()
          if (selected && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(selected).catch(() => {})
          }
          return false
        }
        if (canWriteRef.current) {
          void sendInputRef.current("\x03")
        }
        return false
      })

      term.onData(data => {
        if (!canWriteRef.current || !data) return
        if (needsTerminalPasteConfirmation(data) && data.length > 1) {
          queueOrSendPaste(data)
          return
        }
        void sendInputRef.current(data)
      })

      const termElement = term.element
      if (termElement) {
        const handlePaste = (event: globalThis.ClipboardEvent) => {
          const text = event.clipboardData?.getData("text") ?? ""
          if (!text) return
          event.preventDefault()
          event.stopPropagation()
          if (canWriteRef.current) queueOrSendPaste(text)
        }
        termElement.addEventListener("paste", handlePaste, true)
        cleanupPaste = () => termElement.removeEventListener("paste", handlePaste, true)
      }

      observer = new ResizeObserver(() => {
        if (disposed) return
        fitAddon.fit()
        resizeRef.current(term.cols, term.rows)
      })
      observer.observe(containerRef.current)

      themeObserver = new MutationObserver(() => {
        if (!disposed) term.options.theme = buildTerminalTheme()
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })

      localTerm = term
      xtermRef.current = { term, fitAddon }
      writtenStateRef.current = { jobId: null, generation: -1, resetRevision: -1, chunkCount: 0 }

      // Replay buffered output onto freshly mounted canvas/screen-reader buffer.
      const snapshotOutput = latestOutputRef.current
      if (snapshotOutput.chunks.length > 0) {
        const fullText = terminalOutputText(snapshotOutput)
        term.write(fullText, () => {
          if (followOutputRef.current) term.scrollToBottom()
        })
      }
      writtenStateRef.current = {
        jobId: snapshotOutput.jobId,
        generation: snapshotOutput.generation,
        resetRevision: snapshotOutput.resetRevision,
        chunkCount: snapshotOutput.chunks.length,
      }
    }

    void mountXterm()

    return () => {
      disposed = true
      cleanupPaste?.()
      observer?.disconnect()
      themeObserver?.disconnect()
      xtermRef.current = null
      localTerm?.dispose()
      writtenStateRef.current = { jobId: null, generation: -1, resetRevision: -1, chunkCount: 0 }
    }
  }, [expanded, isPtyRun, queueOrSendPaste, visible])

  // Incremental chunk streaming & parserReset sync to mounted xterm.
  useEffect(() => {
    const instance = xtermRef.current
    if (!instance) return
    const { term } = instance
    const { output } = terminal
    const prev = writtenStateRef.current

    const mustReset = prev.jobId !== output.jobId
      || prev.generation !== output.generation
      || prev.resetRevision !== output.resetRevision
      || output.chunks.length < prev.chunkCount

    if (mustReset) {
      term.reset()
      const text = terminalOutputText(output)
      if (text) {
        term.write(text, () => {
          if (followOutputRef.current) term.scrollToBottom()
        })
      }
    } else if (output.chunks.length > prev.chunkCount) {
      const delta = output.chunks.slice(prev.chunkCount).map(c => c.text).join("")
      if (delta) {
        term.write(delta, () => {
          if (followOutputRef.current) term.scrollToBottom()
        })
      }
    }

    writtenStateRef.current = {
      jobId: output.jobId,
      generation: output.generation,
      resetRevision: output.resetRevision,
      chunkCount: output.chunks.length,
    }
  }, [terminal.output, terminal])

  if (!visible) return null

  const projectHref = job?.requestPath
    ? appendReturnContext(`/projects?path=${encodeURIComponent(job.requestPath)}`, {
      returnTo: hydrated ? currentUrl : undefined,
      originId: hydrated ? entryId : null,
    })
    : null

  function terminalErrorText(code: string | null | undefined): string {
    if (!code) return ""
    const key = `terminal.errors.${code}` as `terminal.errors.${keyof typeof messages.npmRunner.terminal.errors}`
    if (t.has(key)) return t(key)
    const runnerKey = `errors.${code}` as `errors.${keyof typeof messages.npmRunner.errors}`
    return t(t.has(runnerKey) ? runnerKey : "errors.UNKNOWN")
  }

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (!commandInput || !canInteractiveWrite) return
    if (needsTerminalPasteConfirmation(commandInput)) {
      queueOrSendPaste(commandInput)
      return
    }
    const payload = `${commandInput}\r`
    if (!isValidTerminalInputText(payload)) {
      setPasteRejectedTooLarge(true)
      return
    }
    setPasteRejectedTooLarge(false)
    setCommandInput("")
    void dock.sendTerminalInput(payload)
  }

  function handleInputPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData?.getData("text") ?? ""
    if (needsTerminalPasteConfirmation(text) || utf8ByteLength(text) > 4096) {
      event.preventDefault()
      if (canInteractiveWrite) queueOrSendPaste(text)
    }
  }

  const eligibilityReason = state.error?.code ?? runnerEligibility(state, { action: job?.action ?? "install_all" })
  const hasUnknownInput = terminal.inputUnknown || Boolean(job?.terminal?.inputBlocked)

  return (
    <aside
      aria-label={t("terminal.dockTitle")}
      className="sticky bottom-0 z-40 border-t border-border bg-card text-card-foreground shadow-lg"
    >
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <TerminalIcon aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <span className="text-body-sm font-semibold">{t("terminal.dockTitle")}</span>
            <Badge variant={display.status === "success" ? "success" : "secondary"} className="h-auto min-h-6 whitespace-normal">
              {t(`status.${display.status}`)}
            </Badge>
            {job ? (
              <span className="truncate text-body-sm text-muted-foreground">
                {t(`actions.${job.action}`)}
                {job.package ? ` (${job.package})` : ""}
                {job.script ? ` (${job.script})` : ""}
              </span>
            ) : null}
            {projectHref && job ? (
              <Link
                href={projectHref}
                prefetch={false}
                className="truncate font-mono text-body-sm text-ink-soft underline focus-ring"
              >
                {job.requestPath}
              </Link>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canStop ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={state.cancelPending || state.cancelUnknown}
                onClick={() => { void dock.cancel() }}
              >
                <SquareIcon aria-hidden="true" className="size-3.5" />
                {t(display.cancelLabel)}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setDockMode(prev => (prev === "expanded" ? "collapsed" : "expanded"))}
            >
              {expanded ? <ChevronDownIcon aria-hidden="true" className="size-4" /> : <ChevronUpIcon aria-hidden="true" className="size-4" />}
              {t(expanded ? "terminal.collapse" : "terminal.expand")}
            </Button>
            {!busy ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={tCommon("close")}
                onClick={() => dock.dismissCompletedJob()}
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {expanded ? (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-48 max-w-xs flex-1">
                  <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={event => {
                      setSearchQuery(event.target.value)
                      setActiveMatchIndex(0)
                    }}
                    aria-label={t("terminal.searchLabel")}
                    placeholder={t("terminal.searchPlaceholder")}
                    className="h-9 pl-8 text-body-sm"
                  />
                </div>
                {searchQuery.trim() ? (
                  <div className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
                    <span aria-live="polite">{t("terminal.searchMatches", { count: searchResult.count })}</span>
                    {searchResult.count > 0 ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setActiveMatchIndex(i => (i - 1 + searchResult.count) % searchResult.count)}
                        >
                          {t("terminal.prevMatch")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setActiveMatchIndex(i => (i + 1) % searchResult.count)}
                        >
                          {t("terminal.nextMatch")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={followOutput ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={followOutput}
                  onClick={() => {
                    const next = !followOutput
                    setFollowOutput(next)
                    if (next) xtermRef.current?.term.scrollToBottom()
                  }}
                >
                  {t(followOutput ? "terminal.following" : "terminal.followPaused")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    xtermRef.current?.term.clear()
                    dock.clearTerminalOutput()
                  }}
                >
                  <Trash2Icon aria-hidden="true" className="size-3.5" />
                  {t("terminal.clear")}
                </Button>
              </div>
            </div>

            {searchQuery.trim() && searchResult.count > 0 ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2 text-body-sm">
                <p className="font-mono text-muted-foreground">
                  {t("terminal.matchPreview", {
                    index: safeMatchIndex + 1,
                    total: searchResult.count,
                    line: searchResult.matches[safeMatchIndex].line,
                  })}
                  {" — "}
                  <span className="text-foreground">{searchResult.matches[safeMatchIndex].lineText}</span>
                </p>
              </div>
            ) : null}

            {terminal.output.truncated || terminal.output.droppedBytes > 0 || terminal.output.localDroppedBytes > 0 ? (
              <p className="text-body-sm text-muted-foreground">
                {t("terminal.truncatedNotice", {
                  localBytes: terminal.output.localDroppedBytes,
                  serverBytes: terminal.output.droppedBytes,
                })}
              </p>
            ) : null}

            {isPtyRun ? (
              <div className="space-y-3">
                <div
                  ref={containerRef}
                  role="region"
                  aria-label={t("terminal.surfaceLabel")}
                  className="h-64 w-full overflow-hidden rounded-md border border-border bg-card p-2 text-foreground focus-within:ring-2 focus-within:ring-ring"
                />

                {hasUnknownInput ? (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted p-3 text-body-sm">
                    <div className="flex items-center gap-2">
                      <AlertTriangleIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
                      <span>{t("terminal.unknownWarning")}</span>
                    </div>
                    {terminal.pendingSequence !== null && terminal.writer ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={terminal.inputPending}
                        onClick={() => { void dock.reconcileTerminalInput() }}
                      >
                        {t("terminal.reconcileInput")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {pendingPaste !== null ? (
                  <div role="alert" className="space-y-2 rounded-md border border-border bg-muted p-3 text-body-sm">
                    <p>{t("terminal.confirmPasteMessage", { lines: pendingPaste.split(/\r?\n/).length })}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={!canInteractiveWrite}
                        onClick={() => {
                          const text = pendingPaste
                          setPendingPaste(null)
                          if (text) void dock.sendTerminalInput(text)
                        }}
                      >
                        {t("terminal.confirmPasteAction")}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setPendingPaste(null)}>
                        {tCommon("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {pasteRejectedTooLarge ? (
                  <p role="alert" className="text-body-sm text-destructive">{t("terminal.errors.INPUT_TOO_LARGE")}</p>
                ) : null}

                {job?.status === "running" && job.terminal?.ready ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {terminal.writer ? (
                          <Badge variant="success">{t("terminal.writerActive")}</Badge>
                        ) : (
                          <>
                            <span className="text-muted-foreground">
                              {job.terminal.writerGeneration !== null || terminal.claimError === "WRITER_HELD"
                                ? t("terminal.writerHeldOther")
                                : t("terminal.writerNeeded")}
                            </span>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={terminal.claiming || hasUnknownInput}
                              onClick={() => {
                                const needsTakeover = job.terminal?.writerGeneration !== null || terminal.claimError === "WRITER_HELD"
                                void dock.claimTerminal(needsTakeover)
                              }}
                            >
                              {job.terminal.writerGeneration !== null || terminal.claimError === "WRITER_HELD"
                                ? t("terminal.takeoverControl")
                                : t("terminal.claimControl")}
                            </Button>
                          </>
                        )}
                        {terminal.claimError ? (
                          <span className="text-destructive">{terminalErrorText(terminal.claimError)}</span>
                        ) : null}
                        {terminal.inputError && !hasUnknownInput ? (
                          <span className="text-destructive">{terminalErrorText(terminal.inputError)}</span>
                        ) : null}
                      </div>
                    </div>

                    <form onSubmit={handleFormSubmit} className="flex flex-wrap items-center gap-2">
                      <Input
                        value={commandInput}
                        onChange={event => setCommandInput(event.target.value)}
                        onPaste={handleInputPaste}
                        disabled={!canInteractiveWrite}
                        aria-label={t("terminal.inputLabel")}
                        placeholder={t("terminal.inputPlaceholder")}
                        className="h-9 min-w-52 flex-1 font-mono text-body-sm"
                      />
                      <Button type="submit" variant="secondary" size="sm" disabled={!canInteractiveWrite || !commandInput}>
                        {t("terminal.sendInput")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canInteractiveWrite} onClick={() => { void dock.sendTerminalInput("\r") }}>
                        {t("terminal.sendEnter")}
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canInteractiveWrite} onClick={() => { void dock.sendTerminalInput("y\r") }}>
                        y
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canInteractiveWrite} onClick={() => { void dock.sendTerminalInput("n\r") }}>
                        n
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={!canInteractiveWrite} onClick={() => { void dock.sendTerminalInput("\x03") }}>
                        Ctrl+C
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                {job && eligibilityReason === "RUNNING" ? (
                  <p className="text-body-sm text-muted-foreground">{t("terminal.fallbackNotice")}</p>
                ) : null}
                <NpmRunnerLog logs={state.logs} />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
