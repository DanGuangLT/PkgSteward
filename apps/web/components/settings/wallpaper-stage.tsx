"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useSettingsOptional } from "@/components/settings/settings-provider"
import { getBrowserPluginSandboxDocument } from "@/lib/api/settings/settings-browser"
import { resolveActiveWallpaper } from "@/lib/settings/wallpaper-presets"

interface ParticleNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

function readCssToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  )

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = (event: MediaQueryListEvent) => setPrefers(event.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return prefers
}

function BuiltinWallpaperCanvas({
  preset,
  speed,
  paused,
  themeKey,
}: {
  preset: "aurora" | "particles" | "waves" | "matrix" | "mesh"
  speed: number
  paused: boolean
  themeKey: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let width = window.innerWidth
    let height = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const primary = readCssToken("--primary", "Highlight")
    const ring = readCssToken("--ring", "Highlight")
    const foreground = readCssToken("--foreground", "CanvasText")
    const speedFactor = speed / 100

    const particles: ParticleNode[] = Array.from({ length: 48 }, (_, idx) => ({
      x: ((idx * 173) % 100) * (width / 100),
      y: ((idx * 251) % 100) * (height / 100),
      vx: (((idx % 7) - 3) * 0.22 || 0.15) * speedFactor,
      vy: ((((idx * 3) % 7) - 3) * 0.22 || -0.15) * speedFactor,
      radius: 1.5 + (idx % 4) * 0.9,
    }))

    const matrixColWidth = 22
    const matrixCols = Math.max(1, Math.ceil(width / matrixColWidth))
    const drops = Array.from({ length: matrixCols }, (_, i) => (i * 7) % 40)

    let animId = 0
    let tick = 0

    const renderFrame = (advance: boolean) => {
      if (advance) {
        tick += 0.014 * speedFactor
      }

      if (preset === "matrix") {
        ctx.save()
        ctx.globalCompositeOperation = "destination-out"
        ctx.globalAlpha = 0.09
        ctx.fillStyle = foreground
        ctx.fillRect(0, 0, width, height)
        ctx.restore()

        ctx.save()
        ctx.fillStyle = primary
        ctx.font = "14px monospace"
        const glyphs = "01PKGSTEWARD{}[]"
        for (let col = 0; col < drops.length; col += 1) {
          const x = col * matrixColWidth
          const y = drops[col] * 18
          ctx.globalAlpha = 0.45
          const ch = glyphs[(col + Math.floor(drops[col])) % glyphs.length]
          ctx.fillText(ch, x, y)
          if (advance) {
            if (y > height && (col + tick * 10) % 13 > 11) {
              drops[col] = 0
            } else {
              drops[col] += 0.55 * speedFactor
            }
          }
        }
        ctx.restore()
        return
      }

      ctx.clearRect(0, 0, width, height)

      if (preset === "aurora" || preset === "mesh") {
        const orbs =
          preset === "aurora"
            ? [
                { cx: 0.28 + Math.sin(tick * 0.9) * 0.14, cy: 0.35 + Math.cos(tick * 0.7) * 0.12, r: 0.38, alpha: 0.28, color: primary },
                { cx: 0.72 + Math.cos(tick * 0.8) * 0.14, cy: 0.62 + Math.sin(tick * 0.6) * 0.12, r: 0.36, alpha: 0.22, color: ring },
                { cx: 0.5 + Math.sin(tick * 0.5) * 0.18, cy: 0.5 + Math.cos(tick * 1.1) * 0.15, r: 0.28, alpha: 0.16, color: primary },
              ]
            : [
                { cx: 0.2 + Math.sin(tick * 0.6) * 0.08, cy: 0.25 + Math.cos(tick * 0.5) * 0.08, r: 0.34, alpha: 0.24, color: primary },
                { cx: 0.8 + Math.cos(tick * 0.7) * 0.08, cy: 0.25 + Math.sin(tick * 0.4) * 0.08, r: 0.3, alpha: 0.18, color: ring },
                { cx: 0.5 + Math.sin(tick * 0.5) * 0.1, cy: 0.78 + Math.cos(tick * 0.6) * 0.08, r: 0.36, alpha: 0.22, color: primary },
              ]

        ctx.save()
        for (const orb of orbs) {
          ctx.beginPath()
          ctx.arc(orb.cx * width, orb.cy * height, Math.min(width, height) * orb.r, 0, Math.PI * 2)
          ctx.fillStyle = orb.color
          ctx.globalAlpha = orb.alpha
          ctx.fill()
        }
        ctx.restore()
        return
      }

      if (preset === "waves") {
        ctx.save()
        for (let layer = 0; layer < 4; layer += 1) {
          ctx.beginPath()
          const baseY = height * (0.48 + layer * 0.11)
          const amplitude = 24 + layer * 10
          const freq = 0.0045 - layer * 0.0007
          ctx.moveTo(0, height)
          for (let x = 0; x <= width; x += 24) {
            const y = baseY + Math.sin(x * freq + tick * (1.2 + layer * 0.25) + layer) * amplitude
            ctx.lineTo(x, y)
          }
          ctx.lineTo(width, height)
          ctx.closePath()
          ctx.fillStyle = layer % 2 === 0 ? primary : ring
          ctx.globalAlpha = 0.14 - layer * 0.02
          ctx.fill()
        }
        ctx.restore()
        return
      }

      // Particles + constellation lines
      ctx.save()
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i]
        if (advance) {
          p.x += p.vx
          p.y += p.vy
          if (p.x < 0) p.x = width
          if (p.x > width) p.x = 0
          if (p.y < 0) p.y = height
          if (p.y > height) p.y = 0
        }

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fillStyle = primary
        ctx.globalAlpha = 0.42
        ctx.fill()

        for (let j = i + 1; j < particles.length; j += 1) {
          const q = particles[j]
          const dx = p.x - q.x
          const dy = p.y - q.y
          const distSq = dx * dx + dy * dy
          if (distSq < 21_000) {
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(q.x, q.y)
            ctx.strokeStyle = ring
            ctx.globalAlpha = (1 - distSq / 21_000) * 0.18
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
      }
      ctx.restore()
    }

    renderFrame(false)
    if (paused) {
      return () => {
        window.removeEventListener("resize", resize)
      }
    }

    const loop = () => {
      renderFrame(true)
      animId = window.requestAnimationFrame(loop)
    }
    animId = window.requestAnimationFrame(loop)

    return () => {
      window.removeEventListener("resize", resize)
      window.cancelAnimationFrame(animId)
    }
  }, [preset, speed, paused, themeKey])

  const useBlur = preset === "aurora" || preset === "mesh"
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={useBlur ? "h-full w-full scale-110 blur-3xl" : "h-full w-full"}
    />
  )
}

export function WallpaperStage() {
  const ctx = useSettingsOptional()
  const snapshot = ctx?.snapshot ?? null
  const appearance = ctx?.appearance
  const prefersReduced = usePrefersReducedMotion()

  const resolved = useMemo(() => resolveActiveWallpaper(snapshot), [snapshot])
  const [hidden, setHidden] = useState(false)
  const [sandboxState, setSandboxState] = useState<{ pluginId: string; html: string } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.visibilityState === "hidden")
    }
    onVisibility()
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    if (resolved.active) {
      root.dataset.wallpaper = "active"
      root.style.setProperty("--wallpaper-surface-opacity", `${resolved.surfaceOpacity}%`)
    } else {
      delete root.dataset.wallpaper
      root.style.removeProperty("--wallpaper-surface-opacity")
    }
    return () => {
      delete root.dataset.wallpaper
      root.style.removeProperty("--wallpaper-surface-opacity")
    }
  }, [resolved])

  const sandboxPluginId = resolved.active && resolved.kind === "sandbox-html" ? resolved.sourcePluginId : null

  useEffect(() => {
    if (!sandboxPluginId) return
    const controller = new AbortController()
    getBrowserPluginSandboxDocument(sandboxPluginId, controller.signal)
      .then((doc) => {
        if (!controller.signal.aborted) {
          setSandboxState({ pluginId: sandboxPluginId, html: doc.html })
        }
      })
      .catch(() => {
        // Keep stage non-blocking if sandbox document cannot load
      })
    return () => controller.abort()
  }, [sandboxPluginId])

  const reducedMotion =
    appearance?.reducedMotion === "reduce" ||
    (appearance?.reducedMotion !== "normal" && prefersReduced)

  const paused = !resolved.active || reducedMotion || (resolved.pauseWhenHidden && hidden)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (paused) {
      video.pause()
    } else {
      void video.play().catch(() => undefined)
    }
  }, [paused, resolved])

  const activeSandboxHtml =
    sandboxPluginId && sandboxState?.pluginId === sandboxPluginId ? sandboxState.html : null

  const activeConfigJson = resolved.active ? JSON.stringify(resolved.pluginConfig) : ""

  useEffect(() => {
    if (!activeSandboxHtml || !iframeRef.current?.contentWindow || !resolved.active) return
    iframeRef.current.contentWindow.postMessage(
      { type: "pkgsteward:applyUserProperties", properties: resolved.pluginConfig },
      "*"
    )
  }, [activeSandboxHtml, activeConfigJson, resolved])

  if (!resolved.active) {
    return null
  }

  const themeKey = `${appearance?.themeMode ?? "system"}:${appearance?.themePreset ?? "default"}`

  return (
    <div
      aria-hidden
      data-testid="wallpaper-stage"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      <div
        className="h-full w-full"
        style={resolved.blurPx > 0 ? { filter: `blur(${resolved.blurPx}px)`, transform: "scale(1.03)" } : undefined}
      >
        {resolved.kind === "builtin-canvas" && resolved.builtinPreset && (
          <BuiltinWallpaperCanvas
            preset={resolved.builtinPreset}
            speed={resolved.speed}
            paused={paused}
            themeKey={themeKey}
          />
        )}

        {resolved.kind === "image" && resolved.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolved.mediaUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}

        {resolved.kind === "video" && resolved.mediaUrl && (
          <video
            ref={videoRef}
            src={resolved.mediaUrl}
            autoPlay={!paused}
            loop
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}

        {resolved.kind === "sandbox-html" && activeSandboxHtml && (
          <iframe
            ref={iframeRef}
            title={resolved.sourcePluginId}
            sandbox="allow-scripts"
            srcDoc={activeSandboxHtml}
            referrerPolicy="no-referrer"
            onLoad={() => {
              iframeRef.current?.contentWindow?.postMessage(
                { type: "pkgsteward:applyUserProperties", properties: resolved.pluginConfig },
                "*"
              )
            }}
            className="pointer-events-none h-full w-full border-0"
          />
        )}
      </div>

      {resolved.dimOpacity > 0 && (
        <div
          className="absolute inset-0 bg-background"
          style={{ opacity: resolved.dimOpacity / 100 }}
        />
      )}
    </div>
  )
}
