import * as semver from 'semver';
import type {
  IManagerCommandSuggestion,
  INodeManagerInfo,
  IProjectNodeCompatibility,
  IProjectNodeRequirement,
  NodeCompatibilityStatus,
  NodeRequirementSource,
} from '@/node-runtime/interfaces/node-runtime.types';

const SAFE_VERSION_RE = /^[0-9]+(?:\.[0-9]+(?:\.[0-9]+)?)?$/;

const REQUIREMENT_PRECEDENCE: readonly NodeRequirementSource[] = [
  '.nvmrc',
  '.node-version',
  'package.json#engines.node',
];

const SYMBOLIC_ALIASES = new Set([
  'node',
  'stable',
  'unstable',
  'latest',
  'current',
  'system',
  'default',
  'iojs',
]);

export interface IParsedManagerVersions {
  installedVersions: string[];
  activeVersion: string | null;
}

function sanitizeTerminalOutput(stdout: string): string {
  return stdout
    .replaceAll('\u0000', '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

export function sortUniqueSemver(versions: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const version of versions) {
    const valid = semver.valid(version);
    if (valid) unique.add(valid);
  }
  return semver.rsort([...unique]);
}

export function parseNvmWindowsList(stdout: string): IParsedManagerVersions {
  const clean = sanitizeTerminalOutput(stdout);
  const versions: string[] = [];
  let activeVersion: string | null = null;

  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim();
    if (!line || /no installations recognized/i.test(line)) continue;
    const match = line.match(
      /^(\*)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/i,
    );
    if (!match) continue;
    const valid = semver.valid(match[2]);
    if (!valid) continue;
    versions.push(valid);
    if (match[1] === '*' && activeVersion === null) {
      activeVersion = valid;
    }
  }

  return {
    installedVersions: sortUniqueSemver(versions),
    activeVersion,
  };
}

export function parseFnmList(stdout: string): IParsedManagerVersions {
  const clean = sanitizeTerminalOutput(stdout);
  const versions: string[] = [];
  const asteriskVersions: string[] = [];
  let currentVersion: string | null = null;
  let defaultVersion: string | null = null;

  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(
      /^(\*)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(.*))?$/i,
    );
    if (!match) continue;
    const valid = semver.valid(match[2]);
    if (!valid) continue;
    versions.push(valid);

    const hasAsterisk = match[1] === '*';
    const meta = (match[3] ?? '').toLowerCase();
    if (hasAsterisk) asteriskVersions.push(valid);
    if (/\bcurrent\b/.test(meta) && currentVersion === null) {
      currentVersion = valid;
    }
    if (/\bdefault\b/.test(meta) && defaultVersion === null) {
      defaultVersion = valid;
    }
  }

  const singleAsterisk =
    asteriskVersions.length === 1 ? asteriskVersions[0] : null;
  const activeVersion =
    currentVersion ?? singleAsterisk ?? defaultVersion ?? null;

  return {
    installedVersions: sortUniqueSemver(versions),
    activeVersion,
  };
}

export function parseVoltaListNode(stdout: string): IParsedManagerVersions {
  const clean = sanitizeTerminalOutput(stdout);
  const versions: string[] = [];
  let currentVersion: string | null = null;
  let defaultVersion: string | null = null;

  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(
      /^runtime\s+node@v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(.*))?$/i,
    );
    if (!match) continue;
    const valid = semver.valid(match[1]);
    if (!valid) continue;
    versions.push(valid);

    const meta = (match[2] ?? '').toLowerCase();
    if (meta.includes('(current') && currentVersion === null) {
      currentVersion = valid;
    } else if (meta.includes('(default)') && defaultVersion === null) {
      defaultVersion = valid;
    }
  }

  return {
    installedVersions: sortUniqueSemver(versions),
    activeVersion: currentVersion ?? defaultVersion ?? null,
  };
}

export function normalizeNodeRequirement(raw: string): {
  normalizedRange: string | null;
  suggestedVersion: string | null;
} {
  const withoutBom = raw.replace(/^\uFEFF/, '');
  const firstLine = withoutBom.split(/\r?\n/, 1)[0] ?? '';
  const cleaned = firstLine.split('#', 1)[0]?.trim() ?? '';
  if (!cleaned) {
    return { normalizedRange: null, suggestedVersion: null };
  }

  const lower = cleaned.toLowerCase();
  if (lower.startsWith('lts/') || SYMBOLIC_ALIASES.has(lower)) {
    return { normalizedRange: null, suggestedVersion: null };
  }

  const exactCandidate = cleaned.replace(/^v(?=\d)/i, '');
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(exactCandidate)) {
    const exact = semver.valid(exactCandidate);
    if (exact) {
      return { normalizedRange: exact, suggestedVersion: exact };
    }
  }

  const normalizedRange = semver.validRange(cleaned, { loose: false });
  if (!normalizedRange) {
    return { normalizedRange: null, suggestedVersion: null };
  }

  if (normalizedRange === '*') {
    return { normalizedRange, suggestedVersion: null };
  }

  const min = semver.minVersion(normalizedRange)?.version ?? null;
  const suggestedVersion =
    min &&
    SAFE_VERSION_RE.test(min) &&
    (min !== '0.0.0' || cleaned.includes('0.0.0'))
      ? min
      : null;

  return { normalizedRange, suggestedVersion };
}

export function buildSafeManagerCommands(
  suggestedVersion: string | null,
  managers: readonly INodeManagerInfo[],
): IManagerCommandSuggestion[] {
  if (!suggestedVersion || !SAFE_VERSION_RE.test(suggestedVersion)) {
    return [];
  }

  const commands: IManagerCommandSuggestion[] = [];
  for (const manager of managers) {
    if (!manager.detected) continue;
    const alreadyInstalled =
      manager.installedVersions.includes(suggestedVersion);

    if (manager.id === 'nvm-windows') {
      commands.push({
        managerId: manager.id,
        managerLabel: manager.label,
        targetVersion: suggestedVersion,
        alreadyInstalled,
        installCommand: alreadyInstalled
          ? null
          : `nvm install ${suggestedVersion}`,
        switchCommand: `nvm use ${suggestedVersion}`,
      });
    } else if (manager.id === 'fnm') {
      commands.push({
        managerId: manager.id,
        managerLabel: manager.label,
        targetVersion: suggestedVersion,
        alreadyInstalled,
        installCommand: alreadyInstalled
          ? null
          : `fnm install ${suggestedVersion}`,
        switchCommand: `fnm use ${suggestedVersion}`,
      });
    } else if (manager.id === 'volta') {
      commands.push({
        managerId: manager.id,
        managerLabel: manager.label,
        targetVersion: suggestedVersion,
        alreadyInstalled,
        installCommand: alreadyInstalled
          ? null
          : `volta install node@${suggestedVersion}`,
        switchCommand: `volta pin node@${suggestedVersion}`,
      });
    }
  }

  return commands;
}

export function evaluateProjectNodeCompatibility(input: {
  projectPath: string;
  projectName: string | null;
  activeVersion: string;
  requirements: readonly IProjectNodeRequirement[];
  installedVersions: readonly string[];
  managers: readonly INodeManagerInfo[];
}): IProjectNodeCompatibility {
  const orderedRequirements = [...input.requirements].sort(
    (a, b) =>
      REQUIREMENT_PRECEDENCE.indexOf(a.source) -
      REQUIREMENT_PRECEDENCE.indexOf(b.source),
  );
  const effectiveRequirement = orderedRequirements[0] ?? null;

  if (!effectiveRequirement) {
    return {
      path: input.projectPath,
      name: input.projectName,
      status: 'undeclared',
      activeNodeVersion: input.activeVersion,
      effectiveRequirement: null,
      requirements: [],
      matchedInstalledVersion: null,
      suggestedVersion: null,
      commands: [],
    };
  }

  if (!effectiveRequirement.normalizedRange) {
    return {
      path: input.projectPath,
      name: input.projectName,
      status: 'unknown',
      activeNodeVersion: input.activeVersion,
      effectiveRequirement,
      requirements: orderedRequirements,
      matchedInstalledVersion: null,
      suggestedVersion: null,
      commands: [],
    };
  }

  const range = effectiveRequirement.normalizedRange;
  const activeValid = semver.valid(input.activeVersion);
  const status: NodeCompatibilityStatus = activeValid
    ? semver.satisfies(activeValid, range, { includePrerelease: true })
      ? 'compatible'
      : 'mismatch'
    : 'unknown';

  const sortedInstalled = sortUniqueSemver(input.installedVersions);
  const matchedInstalledVersion =
    sortedInstalled.find((version) =>
      semver.satisfies(version, range, { includePrerelease: true }),
    ) ?? null;

  const suggestedVersion =
    matchedInstalledVersion ?? effectiveRequirement.suggestedVersion;

  const commands =
    status === 'mismatch'
      ? buildSafeManagerCommands(suggestedVersion, input.managers)
      : [];

  return {
    path: input.projectPath,
    name: input.projectName,
    status,
    activeNodeVersion: input.activeVersion,
    effectiveRequirement,
    requirements: orderedRequirements,
    matchedInstalledVersion,
    suggestedVersion,
    commands,
  };
}
