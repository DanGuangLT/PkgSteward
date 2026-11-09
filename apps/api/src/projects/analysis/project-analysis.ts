import * as semver from 'semver';
import type {
  IProjectAnalysisDeps,
  IRegistryPackageMetadata,
  RegistryAdvisories,
  RegistryVersions,
} from '@/projects/interfaces/projects.runtime';
import type {
  AnalysisPhase,
  IAnalysisSection,
  IAnalysisResult,
  IProjectAdvisory,
  IProjectInput,
  IProjectOutdated,
  IProjectOutdatedTarget,
  ProjectAnalysisCode,
} from '@/projects/interfaces/projects.types';
import { getProjectOutdatedTargets } from '@/projects/analysis/project-inventory';
import {
  compareProjectText,
  directRegistryNames,
  isLockedVersion,
  isProjectRecord,
  isRegistryPackageName,
  yieldProjectBatch,
} from '@/projects/locks/project-lock-common';

export const PROJECT_ANALYZER = Symbol('PROJECT_ANALYZER');

const DISPLAY_LIMIT = 2000;
const REQUEST_BYTES = 1024 * 1024;
const SEVERITY: Record<IProjectAdvisory['severity'], number> = {
  critical: 0,
  high: 1,
  moderate: 2,
  low: 3,
  info: 4,
  unknown: 5,
};

function section<T>(): IAnalysisSection<T> {
  return {
    state: 'pending',
    items: [],
    warningCodes: [],
    failureCode: null,
    checkedCount: 0,
    totalCount: null,
  };
}

function warn<T>(target: IAnalysisSection<T>, code: ProjectAnalysisCode): void {
  if (!target.warningCodes.includes(code)) target.warningCodes.push(code);
}

function unavailable<T>(
  target: IAnalysisSection<T>,
  code: ProjectAnalysisCode,
): void {
  target.state = 'unavailable';
  target.failureCode = code;
  warn(target, code);
}

function registryCode(error: unknown): ProjectAnalysisCode {
  if (isProjectRecord(error)) {
    switch (error.code) {
      case 'REGISTRY_AUTH_REQUIRED':
      case 'REGISTRY_RATE_LIMITED':
      case 'REGISTRY_UNAVAILABLE':
      case 'PACKAGE_NOT_FOUND':
      case 'INVALID_REGISTRY_RESPONSE':
      case 'LIMIT_EXCEEDED':
        return error.code;
    }
  }
  return 'REGISTRY_UNAVAILABLE';
}

function stopsScheduling(code: ProjectAnalysisCode): boolean {
  return (
    code === 'REGISTRY_UNAVAILABLE' ||
    code === 'REGISTRY_RATE_LIMITED' ||
    code === 'REGISTRY_AUTH_REQUIRED'
  );
}

function emptyRow(
  target: IProjectOutdatedTarget,
  locked: string[],
  warning: ProjectAnalysisCode | null,
): IProjectOutdated {
  return {
    name: target.name,
    registryName: target.registryName ?? target.name,
    lockedVersions: [...locked],
    wanted: null,
    latest: null,
    behindWanted: null,
    behindLatest: null,
    warning,
  };
}

async function outdatedRow(
  target: IProjectOutdatedTarget,
  locked: string[],
  metadata: IRegistryPackageMetadata,
  signal: AbortSignal,
): Promise<IProjectOutdated> {
  const row = emptyRow(target, locked, null);
  const published = new Set<string>();
  let examined = 0;
  for (const version of metadata.versions) {
    if (isLockedVersion(version)) published.add(version);
    if (++examined % 256 === 0) await yieldProjectBatch(signal);
  }
  const latest = metadata.distTags.latest;
  row.latest = isLockedVersion(latest) && published.has(latest) ? latest : null;
  const range = target.kind === 'range' ? new semver.Range(target.spec) : null;
  if (range) {
    let count = 0;
    for (const version of published) {
      if (
        range.test(version) &&
        (row.wanted === null || semver.gt(version, row.wanted))
      ) {
        row.wanted = version;
      }
      if (++count % 256 === 0) await yieldProjectBatch(signal);
    }
  } else {
    const wanted = metadata.distTags[target.spec];
    row.wanted =
      isLockedVersion(wanted) && published.has(wanted) ? wanted : null;
  }
  signal.throwIfAborted();
  if (row.latest === null || row.wanted === null) {
    row.warning = 'INVALID_REGISTRY_RESPONSE';
  } else if (locked.some((version) => !published.has(version))) {
    row.warning = 'PACKAGE_NOT_FOUND';
  } else if (
    metadata.deprecatedVersions?.some(
      (version) =>
        locked.includes(version) ||
        version === row.wanted ||
        version === row.latest,
    )
  ) {
    row.warning = 'DEPRECATED_VERSION';
  }
  const validLocked = locked.length > 0 && locked.every(isLockedVersion);
  if (validLocked && row.wanted !== null) {
    const wanted = row.wanted;
    row.behindWanted = locked.some((version) => semver.lt(version, wanted));
  }
  if (validLocked && row.latest !== null) {
    const newest = row.latest;
    row.behindLatest = locked.some((version) => semver.lt(version, newest));
  }
  return row;
}

async function advisoryBatches(
  versions: Map<string, Set<string>>,
  signal: AbortSignal,
): Promise<RegistryVersions[]> {
  const batches: RegistryVersions[] = [];
  let body: RegistryVersions = Object.create(null) as RegistryVersions;
  let bytes = 2;
  let names = 0;
  let count = 0;
  for (const name of [...versions.keys()].sort(compareProjectText)) {
    const values = [...versions.get(name)!].sort(compareProjectText);
    for (const version of values) {
      let existing: string[] | undefined = body[name];
      const versionBytes = Buffer.byteLength(JSON.stringify(version));
      const extra = () =>
        versionBytes +
        (existing
          ? existing.length > 0
            ? 1
            : 0
          : Buffer.byteLength(JSON.stringify(name)) + 3 + (names > 0 ? 1 : 0));
      if ((!existing && names === 500) || bytes + extra() > REQUEST_BYTES) {
        batches.push(body);
        body = Object.create(null) as RegistryVersions;
        names = 0;
        bytes = 2;
        existing = undefined;
      }
      bytes += extra();
      if (!existing) {
        body[name] = [];
        names++;
      }
      body[name].push(version);
      if (++count % 256 === 0) await yieldProjectBatch(signal);
    }
  }
  if (names > 0) batches.push(body);
  signal.throwIfAborted();
  return batches;
}

function advisoryUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'github.com' || url.hostname === 'www.npmjs.com') &&
      url.pathname.startsWith('/advisories/') &&
      url.pathname.length > '/advisories/'.length
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function collectAdvisories(
  response: RegistryAdvisories,
  submitted: RegistryVersions,
  direct: Set<string>,
  findings: Map<string, IProjectAdvisory>,
  audit: IAnalysisSection<IProjectAdvisory>,
  signal: AbortSignal,
): Promise<void> {
  let count = 0;
  for (const [name, versions] of Object.entries(submitted)) {
    const entries = Object.hasOwn(response, name) ? response[name] : [];
    if (!Array.isArray(entries)) {
      warn(audit, 'INVALID_REGISTRY_RESPONSE');
      continue;
    }
    for (const value of entries) {
      signal.throwIfAborted();
      if (++count % 256 === 0) await yieldProjectBatch(signal);
      if (
        !isProjectRecord(value) ||
        !(
          (typeof value.id === 'string' && value.id.length > 0) ||
          (typeof value.id === 'number' && Number.isSafeInteger(value.id))
        ) ||
        typeof value.title !== 'string' ||
        typeof value.vulnerable_versions !== 'string' ||
        !semver.validRange(value.vulnerable_versions)
      ) {
        warn(audit, 'INVALID_REGISTRY_RESPONSE');
        continue;
      }
      const range = value.vulnerable_versions;
      const parsed = new semver.Range(range);
      const affected: string[] = [];
      for (const version of versions) {
        if (parsed.test(version)) affected.push(version);
        if (++count % 256 === 0) await yieldProjectBatch(signal);
      }
      if (affected.length === 0) continue;
      const id = String(value.id);
      const key = JSON.stringify([name, id, range]);
      const previous = findings.get(key);
      if (previous) {
        previous.affectedVersions = [
          ...new Set([...previous.affectedVersions, ...affected]),
        ].sort(compareProjectText);
        continue;
      }
      const severity = value.severity;
      findings.set(key, {
        id,
        name,
        title: value.title,
        url: advisoryUrl(value.url),
        severity:
          severity === 'critical' ||
          severity === 'high' ||
          severity === 'moderate' ||
          severity === 'low' ||
          severity === 'info'
            ? severity
            : 'unknown',
        range,
        affectedVersions: affected.sort(compareProjectText),
        direct: direct.has(name),
      });
    }
  }
  signal.throwIfAborted();
}

export async function analyzeProject(
  input: IProjectInput,
  signal: AbortSignal,
  deps: IProjectAnalysisDeps,
): Promise<IAnalysisResult> {
  signal.throwIfAborted();
  const result: IAnalysisResult = {
    outdated: section<IProjectOutdated>(),
    audit: section<IProjectAdvisory>(),
    partial: true,
    warningCodes: [...input.warningCodes],
  };
  const targets = getProjectOutdatedTargets(input.manifest);
  const rows = new Array<IProjectOutdated | undefined>(targets.length);
  const findings = new Map<string, IProjectAdvisory>();
  let lastPublication = -Infinity;
  const publish = (phase: AnalysisPhase, force = false) => {
    signal.throwIfAborted();
    const now = deps.now().getTime();
    if (!force && now - lastPublication < 250) return;
    result.outdated.items = rows
      .filter((row): row is IProjectOutdated => row !== undefined)
      .slice(0, DISPLAY_LIMIT);
    result.outdated.totalCount = targets.length;
    result.audit.items = [...findings.values()]
      .sort(
        (a, b) =>
          SEVERITY[a.severity] - SEVERITY[b.severity] ||
          compareProjectText(a.name, b.name) ||
          compareProjectText(a.id, b.id) ||
          compareProjectText(a.range, b.range),
      )
      .slice(0, DISPLAY_LIMIT);
    result.audit.totalCount =
      result.audit.state === 'complete' || result.audit.state === 'partial'
        ? findings.size
        : null;
    if (targets.length > DISPLAY_LIMIT) warn(result.outdated, 'LIMIT_EXCEEDED');
    if (findings.size > DISPLAY_LIMIT) {
      warn(result.audit, 'LIMIT_EXCEEDED');
      if (result.audit.state === 'complete') result.audit.state = 'partial';
    }
    result.warningCodes = [
      ...new Set([
        ...input.warningCodes,
        ...result.outdated.warningCodes,
        ...result.audit.warningCodes,
      ]),
    ].sort(compareProjectText);
    result.partial =
      result.outdated.state !== 'complete' ||
      result.audit.state !== 'complete' ||
      input.warningCodes.length > 0;
    lastPublication = now;
    deps.onSnapshot(structuredClone({ ...result, phase }));
  };
  if (input.registryPolicy) {
    unavailable(result.outdated, input.registryPolicy);
    unavailable(result.audit, input.registryPolicy);
    publish('done', true);
    return result;
  }

  const inventory = await deps.buildInventory(input, signal);
  signal.throwIfAborted();
  result.audit.warningCodes = [...inventory.warningCodes];
  let stopped: ProjectAnalysisCode | null = null;
  let metadataSucceeded = 0;
  result.outdated.state = 'running';
  const groups = new Map<
    string,
    { target: IProjectOutdatedTarget; index: number }[]
  >();
  // A readable lock must verify public provenance before a name leaves the machine.
  const registryNames = new Set(inventory.packages.map((entry) => entry.name));
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    if (index > 0 && index % 256 === 0) await yieldProjectBatch(signal);
    if (
      target.kind === 'unsupported' ||
      !target.registryName ||
      (inventory.coverage !== 'unavailable' &&
        !registryNames.has(target.registryName))
    ) {
      rows[index] = emptyRow(
        target,
        inventory.direct.get(target.name) ?? [],
        'UNSUPPORTED_SPEC',
      );
      warn(result.outdated, 'UNSUPPORTED_SPEC');
      continue;
    }
    const group = groups.get(target.registryName) ?? [];
    group.push({ target, index });
    groups.set(target.registryName, group);
  }
  publish('outdated');
  const pending = [...groups.entries()];
  let cursor = 0;
  let processedRows = 0;
  const worker = async () => {
    while (cursor < pending.length && stopped === null) {
      signal.throwIfAborted();
      const [name, group] = pending[cursor++];
      let metadata: IRegistryPackageMetadata;
      try {
        metadata = await deps.registry.getPackageMetadata(name, signal);
        signal.throwIfAborted();
        metadataSucceeded++;
      } catch (error) {
        signal.throwIfAborted();
        const code = registryCode(error);
        if (stopsScheduling(code)) stopped ??= code;
        for (const { target, index } of group) {
          rows[index] = emptyRow(
            target,
            inventory.direct.get(target.name) ?? [],
            code,
          );
          result.outdated.checkedCount++;
        }
        warn(result.outdated, code);
        publish('outdated');
        continue;
      }
      for (const { target, index } of group) {
        const row = await outdatedRow(
          target,
          inventory.direct.get(target.name) ?? [],
          metadata,
          signal,
        );
        signal.throwIfAborted();
        rows[index] = row;
        result.outdated.checkedCount++;
        if (row.warning) warn(result.outdated, row.warning);
        publish('outdated');
        if (++processedRows % 256 === 0) await yieldProjectBatch(signal);
      }
    }
  };
  // allSettled also contains late worker rejection after an abort.
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(4, pending.length) }, () => worker()),
  );
  signal.throwIfAborted();
  for (const outcome of workers) {
    if (outcome.status === 'rejected') {
      const failure: unknown = outcome.reason;
      if (failure instanceof Error) throw failure;
      throw new Error('Project analysis failed');
    }
  }
  if (stopped !== null) {
    for (let i = 0; i < targets.length; i++) {
      if (!rows[i]) {
        rows[i] = emptyRow(
          targets[i],
          inventory.direct.get(targets[i].name) ?? [],
          stopped,
        );
      }
    }
  }
  // A deprecated version is a finding on a checked row, not missing data.
  const incomplete = result.outdated.warningCodes.some(
    (code) => code !== 'DEPRECATED_VERSION',
  );
  result.outdated.state = incomplete
    ? metadataSucceeded === 0 && stopped !== null
      ? 'unavailable'
      : 'partial'
    : 'complete';
  if (result.outdated.state === 'unavailable') {
    result.outdated.failureCode = stopped;
  }

  if (inventory.coverage === 'unavailable') {
    unavailable(result.audit, inventory.failureCode ?? 'UNSUPPORTED_LOCKFILE');
  } else if (stopped !== null) {
    unavailable(result.audit, stopped);
  } else {
    result.audit.state = 'running';
    const versions = new Map<string, Set<string>>();
    let pairs = 0;
    for (const entry of inventory.packages) {
      signal.throwIfAborted();
      if (
        !isRegistryPackageName(entry.name) ||
        !isLockedVersion(entry.version)
      ) {
        warn(result.audit, 'UNSUPPORTED_SPEC');
        continue;
      }
      const values = versions.get(entry.name) ?? new Set<string>();
      if (values.has(entry.version)) continue;
      if (pairs === 10_000) {
        warn(result.audit, 'LIMIT_EXCEEDED');
        break;
      }
      values.add(entry.version);
      versions.set(entry.name, values);
      if (++pairs % 256 === 0) await yieldProjectBatch(signal);
    }
    const batches = await advisoryBatches(versions, signal);
    const direct = directRegistryNames(input.manifest);
    let succeeded = 0;
    let failed = false;
    for (const body of batches) {
      signal.throwIfAborted();
      let advisories: RegistryAdvisories;
      try {
        advisories = await deps.registry.getBulkAdvisories(body, signal);
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        const code = registryCode(error);
        failed = true;
        warn(result.audit, code);
        result.audit.failureCode = code;
        if (stopsScheduling(code)) break;
        publish('audit');
        continue;
      }
      await collectAdvisories(
        advisories,
        body,
        direct,
        findings,
        result.audit,
        signal,
      );
      signal.throwIfAborted();
      succeeded++;
      result.audit.checkedCount += Object.values(body).reduce(
        (sum, values) => sum + values.length,
        0,
      );
      if (findings.size > DISPLAY_LIMIT) warn(result.audit, 'LIMIT_EXCEEDED');
      publish('audit');
    }
    const complete =
      inventory.coverage === 'complete' &&
      !failed &&
      result.audit.warningCodes.length === 0;
    result.audit.state = complete
      ? 'complete'
      : succeeded > 0 || batches.length === 0
        ? 'partial'
        : 'unavailable';
  }
  publish('done', true);
  return result;
}
