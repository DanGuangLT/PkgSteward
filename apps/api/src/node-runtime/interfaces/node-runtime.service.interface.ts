import type {
  INodeRuntimeOverview,
  IProjectNodeRuntimeDetail,
} from '@/node-runtime/interfaces/node-runtime.types';

export interface INodeRuntimeService {
  getOverview(refresh?: boolean): Promise<INodeRuntimeOverview>;
  getProjectDetail(rawPath: string): Promise<IProjectNodeRuntimeDetail>;
}
