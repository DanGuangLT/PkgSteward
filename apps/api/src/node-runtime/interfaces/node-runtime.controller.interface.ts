import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  GetNodeRuntimeOverviewQueryDto,
  GetProjectNodeRuntimeQueryDto,
} from '@/node-runtime/dto/node-runtime-query.dto';
import type {
  INodeRuntimeOverview,
  IProjectNodeRuntimeDetail,
} from '@/node-runtime/interfaces/node-runtime.types';

export interface INodeRuntimeController {
  getOverview(
    query: GetNodeRuntimeOverviewQueryDto,
  ): Promise<IApiResponse<INodeRuntimeOverview>>;
  getProjectDetail(
    query: GetProjectNodeRuntimeQueryDto,
  ): Promise<IApiResponse<IProjectNodeRuntimeDetail>>;
}
