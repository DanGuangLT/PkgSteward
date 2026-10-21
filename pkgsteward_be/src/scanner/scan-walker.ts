import { NotFoundException } from '@/common/exceptions/app.exception';
import { pathApi, toComparable } from '@/common/utils/path.util';
import type {
  IWalkSnapshot,
  ScanWalker,
} from '@/scanner/interfaces/scanner.types';
import { inspectScanDirectory } from '@/scanner/project-metadata';

export const SCAN_CONCURRENCY = 8;
export const SCAN_WALKER = Symbol('SCAN_WALKER');

interface IQueuedDirectory {
  path: string;
  depth: number;
  isRoot: boolean;
}

const prunesChild = (name: string): boolean =>
  name.startsWith('.') ||
  ['node_modules', 'dist', 'appdata'].includes(name.toLowerCase());

export const walkScan: ScanWalker = (roots, maxDepth, signal, deps) =>
  new Promise<IWalkSnapshot>((resolve, reject) => {
    const { platform, fs } = deps;
    const api = pathApi(platform);
    const work = new AbortController();
    const snapshot: IWalkSnapshot = {
      roots: [],
      projects: [],
      orphanNodeModules: [],
      progress: { visitedDirs: 0, foundProjects: 0, skippedCount: 0 },
    };
    const rootKeys = new Set<string>();
    const projectKeys = new Set<string>();
    const orphanKeys = new Set<string>();
    const queue: (IQueuedDirectory | undefined)[] = roots.map((root) => ({
      path: api.resolve(root),
      depth: 0,
      isRoot: true,
    }));
    let next = 0;
    let active = 0;
    let stopped = false;
    const copy = () => structuredClone(snapshot);
    const stop = () => {
      stopped = true;
      signal.removeEventListener('abort', onAbort);
      // Worker đang chờ I/O vẫn giữ closure; bỏ dữ liệu của lượt quét ngay.
      queue.length = 0;
      next = 0;
      snapshot.roots.length = 0;
      snapshot.projects.length = 0;
      snapshot.orphanNodeModules.length = 0;
      rootKeys.clear();
      projectKeys.clear();
      orphanKeys.clear();
      work.abort();
    };
    const complete = () => {
      if (stopped) return;
      const result = copy();
      stop();
      resolve(result);
    };
    const fail = (error: unknown) => {
      if (stopped) return;
      stop();
      reject(
        error instanceof Error
          ? error
          : new Error('Scan failed', { cause: error }),
      );
    };
    const onAbort = () => complete();
    const publish = () => {
      if (!stopped) deps.onProgress({ ...snapshot.progress });
    };
    const skip = (directory: string, error: unknown) => {
      if (stopped) return;
      snapshot.progress.skippedCount++;
      deps.onSkipped(directory, error);
      publish();
    };

    const visit = async (item: IQueuedDirectory) => {
      const input = item.path;
      // Lỗi guard phải thoát ra ngoài, không được coi là lỗi thư mục cục bộ.
      const lexicalProtected = await deps.isInsideProtectedTree(input);
      if (stopped) return;
      if (lexicalProtected) {
        publish();
        return;
      }

      let canonical: string;
      try {
        if (!item.isRoot) {
          const stats = await fs.lstat(input);
          if (stopped) return;
          if (stats.isSymbolicLink() || !stats.isDirectory()) {
            publish();
            return;
          }
        }
        canonical = api.resolve(await fs.realpath(input));
        if (stopped) return;
        if (item.isRoot) {
          const stats = await fs.lstat(canonical);
          if (stopped) return;
          if (!stats.isDirectory() || stats.isSymbolicLink()) {
            throw new NotFoundException('Scan directory', input);
          }
        }
      } catch (error) {
        skip(input, error);
        return;
      }

      const canonicalProtected = await deps.isInsideProtectedTree(canonical);
      if (stopped) return;
      if (canonicalProtected) {
        publish();
        return;
      }
      if (item.isRoot) {
        const rootKey = toComparable(canonical, platform);
        if (rootKeys.has(rootKey)) {
          publish();
          return;
        }
        rootKeys.add(rootKey);
      }

      let entries: Awaited<ReturnType<typeof fs.readdir>>;
      try {
        entries = await fs.readdir(canonical);
        if (stopped) return;
      } catch (error) {
        skip(canonical, error);
        return;
      }
      if (item.isRoot) snapshot.roots.push(canonical);
      snapshot.progress.visitedDirs++;
      publish();
      if (stopped) return;

      let metadataError: unknown;
      let metadataFailed = false;
      try {
        const metadata = await inspectScanDirectory(canonical, entries, {
          platform,
          fs,
          signal: work.signal,
        });
        if (stopped) return;
        const { project, orphan } = metadata;
        if (project) {
          const key = toComparable(project.path, platform);
          if (!projectKeys.has(key)) {
            projectKeys.add(key);
            snapshot.projects.push(project);
            snapshot.progress.foundProjects++;
          }
        }
        if (orphan) {
          const key = toComparable(orphan.path, platform);
          if (!orphanKeys.has(key)) {
            orphanKeys.add(key);
            snapshot.orphanNodeModules.push(orphan);
          }
        }
      } catch (error) {
        if (stopped) return;
        metadataFailed = true;
        metadataError = error;
      }
      if (maxDepth === 0 || item.depth < maxDepth) {
        for (const entry of entries) {
          if (
            !entry.isDirectory() ||
            entry.isSymbolicLink() ||
            prunesChild(entry.name)
          ) {
            continue;
          }
          queue.push({
            path: api.join(canonical, entry.name),
            depth: item.depth + 1,
            isRoot: false,
          });
        }
      }
      if (metadataFailed) skip(canonical, metadataError);
      else publish();
    };

    const schedule = () => {
      if (stopped) return;
      while (active < SCAN_CONCURRENCY && next < queue.length) {
        const item = queue[next]!;
        queue[next++] = undefined;
        if (next >= 1024 && next * 2 >= queue.length) {
          queue.splice(0, next);
          next = 0;
        }
        active++;
        // Mọi Promise nền đều có catch, kể cả I/O trả lỗi sau huỷ/timeout.
        void visit(item)
          .catch(fail)
          .finally(() => {
            active--;
            schedule();
          });
      }
      if (active === 0 && next === queue.length) complete();
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) complete();
    else schedule();
  });
