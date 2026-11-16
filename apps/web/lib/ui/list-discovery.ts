export function normalizeListQuery(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()
}

export function createListTextMatcher(query: string) {
  const search = normalizeListQuery(query)
  return (...values: readonly (string | null | undefined)[]): boolean => search === ""
    || values.some(value => value != null && normalizeListQuery(value).includes(search))
}

export function selectListItems<T>(
  items: readonly T[], matches: (item: T) => boolean, compare?: (a: T, b: T) => number
): T[] {
  const selected = items.filter(matches)
  return compare ? selected.sort(compare) : selected
}

export function countMatchingItems<T>(items: readonly T[], matches: (item: T) => boolean): number {
  let count = 0
  for (const item of items) if (matches(item)) count++
  return count
}
