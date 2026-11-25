import { win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AppException } from '@/common/exceptions/app.exception';
import type { IGlobalInventoryResult } from '@/global-packages/discovery/global-inventory';
import type {
  IGlobalPreviewFacts,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalAction,
  GlobalReasonCode,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import { assessPnpmGlobalRegistryPolicy } from '@/global-packages/config/pnpm-global-config';
import { assertGlobalPackageMutable } from '@/global-packages/policy/global-policy';
import type {
  IYarnBinSlot,
  IYarnDependencyFacts,
} from '@/global-packages/interfaces/yarn-global.types';

const key = (path: string) => win32.resolve(path).toLowerCase();
const bins = (value: IYarnDependencyFacts['bins']) =>
  [...value]
    .map(({ name, target }) => ({ name, target }))
    .sort((a, b) => a.name.localeCompare(b.name));
const semantic = (d: IYarnDependencyFacts) => ({
  name: d.name,
  spec: d.spec,
  version: d.version,
  linked: d.linked,
  realPath: key(d.realPath),
  bins: bins(d.bins),
  shims: [...d.shims]
    .map((s) => ({ path: key(s.file.path), sha256: s.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path)),
});
const foreignSlots = (slots: readonly IYarnBinSlot[]) =>
  [...slots]
    .filter((s) => s.owner === null)
    .map((s) => ({
      name: s.name.toLowerCase(),
      path: key(s.identity.path),
      sha256: s.sha256,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

const fail = (reason: GlobalReasonCode, status = 409): AppException =>
  new AppException(
    status,
    'Yarn global package mutation refused',
    status === 403 ? 'FORBIDDEN' : 'CONFLICT',
    { reason },
  );

export function assertYarnGlobalMutable(input: {
  location: IGlobalResolvedLocation;
  inventory: IGlobalInventoryResult;
  packageName: string;
  action: GlobalAction;
}): void {
  const { location, inventory, packageName, action } = input;
  const config = location.yarn;
  const facts = inventory.yarnInventory;
  if (
    !config ||
    !facts ||
    inventory.packages.length !== facts.project.dependencies.length
  )
    throw fail('INVENTORY_FAILED');
  if (!inventory.ownershipComplete || !facts.ownershipComplete)
    throw fail('BIN_CONFLICT');
  if (inventory.packages.some((row) => row.status === 'invalid'))
    throw fail('INVENTORY_FAILED');
  const deps = facts.project.dependencies.filter((d) => d.name === packageName);
  if (deps.length !== 1) throw fail('INVENTORY_FAILED');
  if (deps[0].linked) throw fail('LINKED_PACKAGE', 403);
  const protectedPaths = [
    ...location.protectedPaths,
    win32.dirname(location.tool.file),
  ];
  for (const dependency of facts.project.dependencies) {
    // Check both target and every neighbor (including link paths/bins) against protected tooling.
    for (const packageRoot of [dependency.logicalPath, dependency.realPath]) {
      assertGlobalPackageMutable({
        packageName: dependency.name,
        packageRoot,
        linked: false,
        currentBins: dependency.bins,
        targetBins: [],
        binOwners: [],
        ownershipComplete: true,
        protectedPaths,
      });
    }
    if (
      action === 'change' &&
      !assessPnpmGlobalRegistryPolicy({
        packageName: dependency.name,
        action,
        configs: [],
        environment: {},
        provenanceKnown: true,
        pnpmPolicies: [config.policy],
      }).changeAllowed
    )
      throw fail('REGISTRY_CONFIG_UNSUPPORTED');
  }
}

export function verifyYarnGlobalPostcondition(
  before: IGlobalPreviewFacts,
  after: IGlobalInventoryResult,
  request: Pick<IGlobalPreviewRequest, 'action' | 'package'>,
): boolean {
  const previous = before.yarnInventory;
  const current = after.yarnInventory;
  if (
    !previous ||
    !current ||
    !after.ownershipComplete ||
    !current.ownershipComplete
  )
    return false;
  const old = previous.project.dependencies;
  const next = current.project.dependencies;
  if (
    new Set(next.map((d) => d.name)).size !== next.length ||
    next.some((d) => !old.some((p) => p.name === d.name))
  )
    return false;
  if (
    !isDeepStrictEqual(
      foreignSlots(previous.binSlots),
      foreignSlots(current.binSlots),
    )
  )
    return false;
  const targets = old.filter((d) => d.name === request.package);
  if (targets.length !== 1) return false;
  for (const neighbour of old.filter((d) => d.name !== request.package)) {
    const changed = next.filter((d) => d.name === neighbour.name);
    if (
      changed.length !== 1 ||
      !isDeepStrictEqual(semantic(neighbour), semantic(changed[0]))
    )
      return false;
  }
  const target = next.filter((d) => d.name === request.package);
  const row = after.packages.filter((d) => d.name === request.package);
  if (request.action === 'remove') {
    if (
      target.length ||
      row.length ||
      after.facts.some((d) => d.name === request.package) ||
      current.binSlots.some((s) => s.owner === request.package)
    )
      return false;
  } else if (request.action === 'change') {
    const exact = before.target;
    const installed = after.facts.filter((d) => d.name === request.package);
    if (
      !exact ||
      target.length !== 1 ||
      row.length !== 1 ||
      row[0].status !== 'manageable' ||
      installed.length !== 1 ||
      installed[0].version !== exact.version ||
      !target[0].manifest ||
      target[0].linked ||
      target[0].version !== exact.version ||
      row[0].version !== exact.version ||
      !isDeepStrictEqual(bins(target[0].bins), bins(exact.bins)) ||
      !isDeepStrictEqual(bins(row[0].bins), bins(exact.bins)) ||
      !isDeepStrictEqual(bins(installed[0].bins), bins(exact.bins))
    )
      return false;
    for (const bin of target[0].bins) {
      for (const ext of ['', '.cmd']) {
        const slot = current.binSlots.find(
          (s) => s.name.toLowerCase() === `${bin.name}${ext}`.toLowerCase(),
        );
        if (
          !slot ||
          slot.owner !== request.package ||
          !slot.sha256 ||
          !target[0].shims.some(
            (s) =>
              key(s.file.path) === key(slot.identity.path) &&
              s.sha256 === slot.sha256,
          )
        )
          return false;
      }
    }
  } else return false;

  const remaining = new Set(
    target[0]?.bins.map((b) => b.name.toLowerCase()) ?? [],
  );
  const retired = new Set(
    targets[0].bins
      .filter((b) => !remaining.has(b.name.toLowerCase()))
      .map((b) => b.name.toLowerCase()),
  );
  if (
    current.binSlots.some((s) =>
      retired.has(
        s.name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/i, ''),
      ),
    )
  )
    return false;
  return true;
}
