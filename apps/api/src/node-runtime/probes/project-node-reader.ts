import type { Stats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import {
  isSameOrInside,
  pathApi,
  toComparable,
  toPathPlatform,
} from '@/common/utils/path.util';
import type { IProjectNodeRequirement } from '@/node-runtime/interfaces/node-runtime.types';
import { normalizeNodeRequirement } from '@/node-runtime/parsers/node-version.parser';

const MAX_VERSION_FILE_BYTES = 1024;
const MAX_PACKAGE_JSON_BYTES = 2 * 1024 * 1024;

export interface IProjectNodeFsDeps {
  lstat: (filePath: string) => Promise<Stats>;
  realpath: (filePath: string) => Promise<string>;
  readFile: (filePath: string, encoding: 'utf8') => Promise<string>;
}

const defaultFsDeps: IProjectNodeFsDeps = {
  lstat: (filePath) => lstat(filePath),
  realpath: (filePath) => realpath(filePath),
  readFile: (filePath, encoding) => readFile(filePath, encoding),
};

export interface IProjectNodeConfigRead {
  packageName: string | null;
  requirements: IProjectNodeRequirement[];
}

async function readSafeProjectTextFile(
  projectDirReal: string,
  comparableRoot: string,
  fileName: string,
  maxBytes: number,
  deps: IProjectNodeFsDeps,
): Promise<string | null> {
  const platform = toPathPlatform();
  const candidate = pathApi(platform).join(projectDirReal, fileName);

  try {
    const stat = await deps.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    if (stat.size > maxBytes) return null;

    const realFile = await deps.realpath(candidate);
    if (
      !isSameOrInside(
        toComparable(realFile, platform),
        comparableRoot,
        platform,
      )
    ) {
      return null;
    }

    const content = await deps.readFile(realFile, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) return null;
    return content;
  } catch {
    return null;
  }
}

function extractFirstRawLine(content: string): string | null {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstMeaningful = lines.find((line) => !line.startsWith('#'));
  return firstMeaningful && firstMeaningful.length > 0 ? firstMeaningful : null;
}

export async function readProjectNodeConfig(
  projectDir: string,
  deps: IProjectNodeFsDeps = defaultFsDeps,
): Promise<IProjectNodeConfigRead> {
  const platform = toPathPlatform();
  let projectDirReal: string;
  try {
    projectDirReal = await deps.realpath(projectDir);
  } catch {
    return { packageName: null, requirements: [] };
  }
  const comparableRoot = toComparable(projectDirReal, platform);

  const [nvmrcText, nodeVersionText, packageJsonText] = await Promise.all([
    readSafeProjectTextFile(
      projectDirReal,
      comparableRoot,
      '.nvmrc',
      MAX_VERSION_FILE_BYTES,
      deps,
    ),
    readSafeProjectTextFile(
      projectDirReal,
      comparableRoot,
      '.node-version',
      MAX_VERSION_FILE_BYTES,
      deps,
    ),
    readSafeProjectTextFile(
      projectDirReal,
      comparableRoot,
      'package.json',
      MAX_PACKAGE_JSON_BYTES,
      deps,
    ),
  ]);

  const requirements: IProjectNodeRequirement[] = [];
  let packageName: string | null = null;

  if (nvmrcText !== null) {
    const raw = extractFirstRawLine(nvmrcText);
    if (raw) {
      requirements.push({
        source: '.nvmrc',
        raw,
        ...normalizeNodeRequirement(raw),
      });
    }
  }

  if (nodeVersionText !== null) {
    const raw = extractFirstRawLine(nodeVersionText);
    if (raw) {
      requirements.push({
        source: '.node-version',
        raw,
        ...normalizeNodeRequirement(raw),
      });
    }
  }

  if (packageJsonText !== null) {
    try {
      const parsed: unknown = JSON.parse(
        packageJsonText.replace(/^\uFEFF/, ''),
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.name === 'string' && record.name.trim().length > 0) {
          packageName = record.name.trim();
        }
        const engines = record.engines;
        if (
          engines &&
          typeof engines === 'object' &&
          !Array.isArray(engines) &&
          typeof (engines as Record<string, unknown>).node === 'string'
        ) {
          const raw = (
            (engines as Record<string, unknown>).node as string
          ).trim();
          if (raw.length > 0) {
            requirements.push({
              source: 'package.json#engines.node',
              raw,
              ...normalizeNodeRequirement(raw),
            });
          }
        }
      }
    } catch {
      // Ignore malformed package.json files cleanly.
    }
  }

  return { packageName, requirements };
}

export async function readProjectNodeRequirements(
  projectDir: string,
  deps: IProjectNodeFsDeps = defaultFsDeps,
): Promise<IProjectNodeRequirement[]> {
  const config = await readProjectNodeConfig(projectDir, deps);
  return config.requirements;
}
