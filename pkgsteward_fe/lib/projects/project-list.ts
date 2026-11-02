import type { ScannedProject } from "@/lib/api/types"

export type ProjectSort = "activity" | "name"

export function projectDisplayName(project: ScannedProject): string {
  return project.name ?? project.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? ""
}

export function selectProjects(
  projects: readonly ScannedProject[],
  query: string,
  sort: ProjectSort,
  locale: string
): ScannedProject[] {
  const search = query.trim().toLowerCase()
  const collator = new Intl.Collator(locale)

  return projects.filter((project) => (
    projectDisplayName(project).toLowerCase().includes(search) ||
    project.path.toLowerCase().includes(search)
  )).sort((a, b) => {
    const order = sort === "activity"
      ? Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
      : collator.compare(projectDisplayName(a), projectDisplayName(b))

    return order || collator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  })
}
