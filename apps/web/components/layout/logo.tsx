import type { SVGProps } from "react"

/**
 * Logo PkgSteward: chữ P có phần bụng là hộp package. Cùng hình với
 * app/icon.svg; nền lấy màu primary của theme, nét lấy primary-foreground.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false" {...props}>
      <rect width="512" height="512" rx="112" className="fill-primary" />
      <g
        fill="none"
        strokeWidth="40"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      >
        <path d="M168 420V152L276 90l108 62v124l-108 62-108-62" />
        <path d="M168 152l108 62 108-62M276 214v124" />
      </g>
    </svg>
  )
}
