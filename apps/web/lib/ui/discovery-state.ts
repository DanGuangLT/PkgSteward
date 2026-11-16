import type { ViewStateCodec } from "@/lib/ui/navigation-targets"

export function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T)
}
export function isEnumArray<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length
    && value.every(item => isEnumValue(item, allowed))
}

// Only explicitly declared display controls may cross the storage boundary.
export function createDiscoveryCodec<T extends { query: string }>(
  initial: T, validate: (raw: Record<string, unknown>) => boolean
): ViewStateCodec<T> {
  const keys = Object.keys(initial)
  const decode = (value: unknown): T | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))
      || typeof raw.query !== "string" || raw.query.length > 512 || !validate(raw)) return null
    return structuredClone(raw) as T
  }
  return { version: 1, decode, encode: (value: T) => decode(value) ?? structuredClone(initial) }
}
export const TEXT_DISCOVERY = { query: "" }
export const textDiscoveryCodec = createDiscoveryCodec(TEXT_DISCOVERY, () => true)
