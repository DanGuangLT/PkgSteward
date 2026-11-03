import type { FileTreeEntry } from "@/lib/api/types"

// Giới hạn `paths` của backend cho preview, summary và execute.
export const MAX_DELETE_PATHS = 1000

export type TreeCheckState = "checked" | "indeterminate" | "unchecked"
export type LoadedChildren = (path: string) => readonly FileTreeEntry[] | undefined

export function isInsidePath(parent: string, path: string): boolean {
  return path.startsWith(`${parent}\\`) || path.startsWith(`${parent}/`)
}

export function treeCheckState(selected: ReadonlySet<string>, path: string): TreeCheckState {
  if (selected.has(path)) return "checked"
  let indeterminate = false
  for (const candidate of selected) {
    if (isInsidePath(candidate, path)) return "checked"
    if (isInsidePath(path, candidate)) indeterminate = true
  }
  return indeterminate ? "indeterminate" : "unchecked"
}

/**
 * Folder đã chọn nghĩa là xoá cả cây con, kể cả phần chưa tải. Bỏ chọn một mục con thì
 * folder không còn được xoá nguyên khối: giữ lại các mục cùng cấp đã tải trên đường đi,
 * phần chưa tải được bỏ chứ không đoán (thà xoá ít hơn đã chọn).
 */
export function toggleTreePath(
  selected: ReadonlySet<string>,
  entry: FileTreeEntry,
  childrenOf: LoadedChildren
): Set<string> {
  const next = new Set(selected)
  if (!entry.selectable) return next

  if (treeCheckState(selected, entry.path) !== "checked") {
    for (const path of selected) {
      if (isInsidePath(entry.path, path)) next.delete(path)
    }
    next.add(entry.path)
    return next
  }

  if (next.delete(entry.path)) return next

  const ancestor = [...selected].find((path) => isInsidePath(path, entry.path))
  if (ancestor === undefined) return next
  next.delete(ancestor)
  let folder = ancestor
  while (folder !== entry.path) {
    const children = childrenOf(folder) ?? []
    const route = children.find((child) => child.path === entry.path || isInsidePath(child.path, entry.path))
    for (const child of children) {
      if (child.selectable && child !== route) next.add(child.path)
    }
    if (route === undefined) break
    folder = route.path
  }
  return next
}
