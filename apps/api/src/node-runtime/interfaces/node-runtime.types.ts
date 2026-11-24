export type NodeManagerId = 'nvm-windows' | 'fnm' | 'volta';

export type NodeRequirementSource =
  '.nvmrc' | '.node-version' | 'package.json#engines.node';

export type NodeCompatibilityStatus =
  'compatible' | 'mismatch' | 'unknown' | 'undeclared';

export interface INodeManagerInfo {
  id: NodeManagerId;
  label: string;
  detected: boolean;
  activeVersion: string | null;
  installedVersions: string[];
}

export interface IProjectNodeRequirement {
  source: NodeRequirementSource;
  raw: string;
  normalizedRange: string | null;
  suggestedVersion: string | null;
}

export interface IManagerCommandSuggestion {
  managerId: NodeManagerId;
  managerLabel: string;
  targetVersion: string;
  alreadyInstalled: boolean;
  installCommand: string | null;
  switchCommand: string;
}

export interface IProjectNodeCompatibility {
  path: string;
  name: string | null;
  status: NodeCompatibilityStatus;
  activeNodeVersion: string;
  effectiveRequirement: IProjectNodeRequirement | null;
  requirements: IProjectNodeRequirement[];
  matchedInstalledVersion: string | null;
  suggestedVersion: string | null;
  commands: IManagerCommandSuggestion[];
}

export interface INodeRuntimeSummaryCounts {
  total: number;
  compatible: number;
  mismatch: number;
  unknown: number;
  undeclared: number;
}

export interface INodeRuntimeOverview {
  activeNodeVersion: string;
  activeVersionSupported: boolean;
  checkedAt: string;
  scanId: string | null;
  managers: INodeManagerInfo[];
  installedVersions: string[];
  counts: INodeRuntimeSummaryCounts;
  projects: IProjectNodeCompatibility[];
}

export interface IProjectNodeRuntimeDetail {
  checkedAt: string;
  activeNodeVersion: string;
  activeVersionSupported: boolean;
  managers: INodeManagerInfo[];
  project: IProjectNodeCompatibility;
}
