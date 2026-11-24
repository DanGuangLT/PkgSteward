import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type {
  IManagerCommandSuggestion,
  INodeManagerInfo,
  INodeRuntimeOverview,
  INodeRuntimeSummaryCounts,
  IProjectNodeCompatibility,
  IProjectNodeRequirement,
  IProjectNodeRuntimeDetail,
  NodeCompatibilityStatus,
  NodeManagerId,
  NodeRequirementSource,
} from '@/node-runtime/interfaces/node-runtime.types';

export class NodeManagerInfoEntity implements INodeManagerInfo {
  @ApiProperty({ enum: ['nvm-windows', 'fnm', 'volta'] })
  id!: NodeManagerId;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  detected!: boolean;

  @ApiProperty({ type: String, nullable: true })
  activeVersion!: string | null;

  @ApiProperty({ type: [String] })
  installedVersions!: string[];
}

export class ProjectNodeRequirementEntity implements IProjectNodeRequirement {
  @ApiProperty({
    enum: ['.nvmrc', '.node-version', 'package.json#engines.node'],
  })
  source!: NodeRequirementSource;

  @ApiProperty()
  raw!: string;

  @ApiProperty({ type: String, nullable: true })
  normalizedRange!: string | null;

  @ApiProperty({ type: String, nullable: true })
  suggestedVersion!: string | null;
}

export class ManagerCommandSuggestionEntity implements IManagerCommandSuggestion {
  @ApiProperty({ enum: ['nvm-windows', 'fnm', 'volta'] })
  managerId!: NodeManagerId;

  @ApiProperty()
  managerLabel!: string;

  @ApiProperty()
  targetVersion!: string;

  @ApiProperty()
  alreadyInstalled!: boolean;

  @ApiProperty({ type: String, nullable: true })
  installCommand!: string | null;

  @ApiProperty()
  switchCommand!: string;
}

export class ProjectNodeCompatibilityEntity implements IProjectNodeCompatibility {
  @ApiProperty()
  path!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({
    enum: ['compatible', 'mismatch', 'unknown', 'undeclared'],
  })
  status!: NodeCompatibilityStatus;

  @ApiProperty()
  activeNodeVersion!: string;

  @ApiProperty({ type: ProjectNodeRequirementEntity, nullable: true })
  @Type(() => ProjectNodeRequirementEntity)
  effectiveRequirement!: IProjectNodeRequirement | null;

  @ApiProperty({ type: [ProjectNodeRequirementEntity] })
  @Type(() => ProjectNodeRequirementEntity)
  requirements!: IProjectNodeRequirement[];

  @ApiProperty({ type: String, nullable: true })
  matchedInstalledVersion!: string | null;

  @ApiProperty({ type: String, nullable: true })
  suggestedVersion!: string | null;

  @ApiProperty({ type: [ManagerCommandSuggestionEntity] })
  @Type(() => ManagerCommandSuggestionEntity)
  commands!: IManagerCommandSuggestion[];
}

export class NodeRuntimeSummaryCountsEntity implements INodeRuntimeSummaryCounts {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  compatible!: number;

  @ApiProperty()
  mismatch!: number;

  @ApiProperty()
  unknown!: number;

  @ApiProperty()
  undeclared!: number;
}

export class NodeRuntimeOverviewEntity implements INodeRuntimeOverview {
  @ApiProperty()
  activeNodeVersion!: string;

  @ApiProperty()
  activeVersionSupported!: boolean;

  @ApiProperty()
  checkedAt!: string;

  @ApiProperty({ type: String, nullable: true })
  scanId!: string | null;

  @ApiProperty({ type: [NodeManagerInfoEntity] })
  @Type(() => NodeManagerInfoEntity)
  managers!: INodeManagerInfo[];

  @ApiProperty({ type: [String] })
  installedVersions!: string[];

  @ApiProperty({ type: NodeRuntimeSummaryCountsEntity })
  @Type(() => NodeRuntimeSummaryCountsEntity)
  counts!: INodeRuntimeSummaryCounts;

  @ApiProperty({ type: [ProjectNodeCompatibilityEntity] })
  @Type(() => ProjectNodeCompatibilityEntity)
  projects!: IProjectNodeCompatibility[];
}

export class ProjectNodeRuntimeDetailEntity implements IProjectNodeRuntimeDetail {
  @ApiProperty()
  checkedAt!: string;

  @ApiProperty()
  activeNodeVersion!: string;

  @ApiProperty()
  activeVersionSupported!: boolean;

  @ApiProperty({ type: [NodeManagerInfoEntity] })
  @Type(() => NodeManagerInfoEntity)
  managers!: INodeManagerInfo[];

  @ApiProperty({ type: ProjectNodeCompatibilityEntity })
  @Type(() => ProjectNodeCompatibilityEntity)
  project!: IProjectNodeCompatibility;
}
