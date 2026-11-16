import type {
  IRunJob,
  IRunLogPage,
  IRunRequest,
  IRunStart,
  IRunnerContext,
  ITerminalClaimBody,
  ITerminalInputAckBody,
  ITerminalInputBody,
  ITerminalResizeBody,
  ITerminalResizeResult,
} from '@/npm-runner/interfaces/npm-runner.types';
import type { ITerminalOutputPage } from '@/npm-runner/terminal/terminal-buffer';
import type {
  ITerminalInputAck,
  ITerminalWriter,
} from '@/npm-runner/terminal/terminal-control';

export interface INpmRunnerService {
  context(path: string): Promise<IRunnerContext>;
  start(input: IRunRequest): Promise<IRunStart>;
  latest(): IRunJob;
  get(id: string): IRunJob;
  logs(id: string, cursor: number): IRunLogPage;
  cancel(id: string): Promise<IRunJob>;
  terminalOutput(
    id: string,
    generation: number,
    cursor: number,
  ): ITerminalOutputPage;
  claimTerminal(id: string, request: ITerminalClaimBody): ITerminalWriter;
  terminalInput(
    id: string,
    request: ITerminalInputBody,
  ): Promise<ITerminalInputAck>;
  terminalInputAck(
    id: string,
    request: ITerminalInputAckBody,
  ): ITerminalInputAck;
  terminalResize(
    id: string,
    request: ITerminalResizeBody,
  ): ITerminalResizeResult;
}
