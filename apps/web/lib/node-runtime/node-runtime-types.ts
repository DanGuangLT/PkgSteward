export type NodeManagerId = "nvm-windows" | "fnm" | "volta"

export type NodeRequirementSource = ".nvmrc" | ".node-version" | "package.json#engines.node"

export type NodeCompatibilityStatus = "compatible" | "mismatch" | "unknown" | "undeclared"

export type NodeProjectSort = "priority" | "name"

export interface NodeManagerInfo {
  id: NodeManagerId
  label: string
  detected: boolean
  activeVersion: string | null
  installedVersions: string[]
}

export interface ProjectNodeRequirement {
  source: NodeRequirementSource
  raw: string
  normalizedRange: string | null
  suggestedVersion: string | null
}

export interface ManagerCommandSuggestion {
  managerId: NodeManagerId
  managerLabel: string
  targetVersion: string
  alreadyInstalled: boolean
  installCommand: string | null
  switchCommand: string
}

export interface ProjectNodeCompatibility {
  path: string
  name: string | null
  status: NodeCompatibilityStatus
  activeNodeVersion: string
  effectiveRequirement: ProjectNodeRequirement | null
  requirements: ProjectNodeRequirement[]
  matchedInstalledVersion: string | null
  suggestedVersion: string | null
  commands: ManagerCommandSuggestion[]
}

export interface NodeRuntimeSummaryCounts {
  total: number
  compatible: number
  mismatch: number
  unknown: number
  undeclared: number
}

export interface NodeRuntimeOverview {
  activeNodeVersion: string
  activeVersionSupported: boolean
  checkedAt: string
  scanId: string | null
  managers: NodeManagerInfo[]
  installedVersions: string[]
  counts: NodeRuntimeSummaryCounts
  projects: ProjectNodeCompatibility[]
}

export interface ProjectNodeRuntimeDetail {
  checkedAt: string
  activeNodeVersion: string
  activeVersionSupported: boolean
  managers: NodeManagerInfo[]
  project: ProjectNodeCompatibility
}
