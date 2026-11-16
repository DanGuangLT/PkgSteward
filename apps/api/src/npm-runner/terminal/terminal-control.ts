import { createHash } from 'node:crypto';
import {
  assertTerminalIdentity,
  assertTerminalInput,
  assertTerminalSize,
  assertTerminalUuid,
  terminalFailure,
  terminalInteger,
  TERMINAL_LIMITS,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  ITerminalIdentity,
  ITerminalInputFrame,
  ITerminalSize,
  TerminalDeliveryStatus,
} from '@/npm-runner/terminal/terminal-protocol';

export interface ITerminalWriter {
  tabId: string;
  token: string;
  writerGeneration: number;
}
export interface ITerminalInputRequest
  extends ITerminalIdentity, ITerminalWriter {
  sequence: number;
  text: string;
}
export interface ITerminalResizeRequest
  extends ITerminalIdentity, ITerminalWriter, ITerminalSize {}
export interface ITerminalInputAck extends ITerminalIdentity {
  writerGeneration: number;
  sequence: number;
  status: TerminalDeliveryStatus | 'pending';
  receivedAt: number;
}
export interface ITerminalControlDeps {
  now(): number;
  token(): string;
  write(input: ITerminalInputFrame): Promise<TerminalDeliveryStatus>;
  resize(size: ITerminalSize, writerGeneration: number): Promise<void>;
}
export type TerminalControlState =
  'running' | 'stopping' | 'terminal' | 'worker_lost';

interface IReceipt {
  hash: string;
  ack: ITerminalInputAck;
  revision: number;
}

export class TerminalControl {
  private readonly identity: ITerminalIdentity;
  private readonly receipts = new Map<number, IReceipt>();
  private writer: ITerminalWriter | null = null;
  private writerGeneration = 0;
  private lastSequence = 0;
  private unresolved: number | null = null;
  private state: TerminalControlState = 'running';
  private pendingResize: ITerminalResizeRequest | null = null;
  private flushingResize: Promise<void> | null = null;

  constructor(
    identity: ITerminalIdentity,
    private readonly deps: ITerminalControlDeps,
  ) {
    assertTerminalIdentity(identity);
    this.identity = { ...identity };
  }

  claim(
    identity: ITerminalIdentity,
    tabId: string,
    takeover = false,
  ): ITerminalWriter {
    assertTerminalIdentity(identity, this.identity);
    assertTerminalUuid(tabId);
    this.assertRunning();
    if (typeof takeover !== 'boolean') terminalFailure(400, 'INVALID_INPUT');
    if (this.writer && !takeover) {
      if (this.writer.tabId !== tabId) terminalFailure(409, 'WRITER_HELD');
      return { ...this.writer };
    }
    this.assertResolved();
    if (this.writerGeneration === Number.MAX_SAFE_INTEGER)
      terminalFailure(409, 'INVALID_SEQUENCE');
    const token = this.deps.token();
    assertTerminalUuid(token);
    if (token === this.writer?.token)
      terminalFailure(409, 'TOKEN_GENERATION_FAILED');
    this.writer = { tabId, token, writerGeneration: ++this.writerGeneration };
    this.lastSequence = 0;
    this.receipts.clear();
    this.pendingResize = null;
    return { ...this.writer };
  }

  async input(request: ITerminalInputRequest): Promise<ITerminalInputAck> {
    assertTerminalIdentity(request, this.identity);
    this.assertWriter(request);
    this.assertRunning();
    assertTerminalInput(request.text);
    if (!terminalInteger(request.sequence))
      terminalFailure(400, 'INVALID_SEQUENCE');
    const hash = createHash('sha256')
      .update(request.text, 'utf8')
      .digest('hex');
    const prior = this.receipts.get(request.sequence);
    if (prior) {
      if (prior.hash !== hash) terminalFailure(409, 'INPUT_CONFLICT');
      return { ...prior.ack };
    }
    this.assertResolved();
    if (this.receipts.size >= TERMINAL_LIMITS.receipts)
      terminalFailure(409, 'INPUT_HISTORY_FULL');
    if (request.sequence !== this.lastSequence + 1)
      terminalFailure(409, 'INPUT_GAP');
    const receivedAt = this.deps.now();
    if (!terminalInteger(receivedAt, 0)) terminalFailure(400, 'INVALID_CLOCK');
    const receipt: IReceipt = {
      hash,
      ack: {
        ...this.identity,
        writerGeneration: this.writerGeneration,
        sequence: request.sequence,
        status: 'pending',
        receivedAt,
      },
      revision: 0,
    };
    // Reserve synchronously before invoking the adapter. A rejected promise cannot authorize replay.
    this.receipts.set(request.sequence, receipt);
    this.lastSequence = request.sequence;
    this.unresolved = request.sequence;
    let status: TerminalDeliveryStatus;
    try {
      status = await this.deps.write({
        ...this.identity,
        type: 'input',
        writerGeneration: this.writerGeneration,
        sequence: request.sequence,
        text: request.text,
      });
      if (!['delivered', 'not_delivered', 'unknown'].includes(status))
        status = 'unknown';
    } catch {
      status = 'unknown';
    }
    // A trusted reconciliation or lifecycle event supersedes late adapter completion.
    if (receipt.revision === 0) this.updateReceipt(receipt, status);
    return { ...receipt.ack };
  }

  ack(
    identity: ITerminalIdentity,
    writer: ITerminalWriter,
    sequence: number,
  ): ITerminalInputAck {
    assertTerminalIdentity(identity, this.identity);
    this.assertWriter(writer);
    if (!terminalInteger(sequence)) terminalFailure(400, 'INVALID_SEQUENCE');
    const receipt = this.receipts.get(sequence);
    if (!receipt) terminalFailure(404, 'ACK_NOT_FOUND');
    return { ...receipt.ack };
  }

  reconcile(
    identity: ITerminalIdentity,
    writerGeneration: number,
    sequence: number,
    status: Exclude<TerminalDeliveryStatus, 'unknown'>,
  ): void {
    assertTerminalIdentity(identity, this.identity);
    if (writerGeneration !== this.writerGeneration || !this.writer)
      terminalFailure(409, 'STALE_WRITER');
    if (
      !terminalInteger(sequence) ||
      !['delivered', 'not_delivered'].includes(status)
    )
      terminalFailure(400, 'INVALID_SEQUENCE');
    const receipt = this.receipts.get(sequence);
    if (!receipt) terminalFailure(404, 'ACK_NOT_FOUND');
    if (
      receipt.ack.status === 'delivered' ||
      receipt.ack.status === 'not_delivered'
    ) {
      if (receipt.ack.status !== status) terminalFailure(409, 'INPUT_CONFLICT');
      return;
    }
    receipt.revision++;
    this.updateReceipt(receipt, status);
  }

  resize(request: ITerminalResizeRequest): void {
    assertTerminalIdentity(request, this.identity);
    this.assertWriter(request);
    this.assertRunning();
    this.assertResolved();
    assertTerminalSize(request);
    this.pendingResize = { ...request };
  }

  async flushResize(): Promise<void> {
    if (this.flushingResize) {
      await this.flushingResize;
      return this.flushResize();
    }
    if (!this.pendingResize) return;
    const flush = async () => {
      while (this.pendingResize) {
        const request = this.pendingResize;
        this.pendingResize = null;
        this.assertRunning();
        this.assertResolved();
        this.assertWriter(request);
        try {
          await this.deps.resize(
            { cols: request.cols, rows: request.rows },
            request.writerGeneration,
          );
        } catch {
          terminalFailure(409, 'RESIZE_FAILED');
        }
      }
    };
    this.flushingResize = flush();
    try {
      await this.flushingResize;
    } finally {
      this.flushingResize = null;
    }
  }

  setState(state: TerminalControlState): void {
    if (!['running', 'stopping', 'terminal', 'worker_lost'].includes(state))
      terminalFailure(400, 'INVALID_INPUT');
    if (this.state !== 'running' && state === 'running')
      terminalFailure(409, 'NOT_RUNNING');
    this.state = state;
    if (state !== 'running') {
      this.pendingResize = null;
      if (this.unresolved !== null) {
        const receipt = this.receipts.get(this.unresolved)!;
        receipt.revision++;
        receipt.ack.status = 'unknown';
      }
    }
  }

  private updateReceipt(
    receipt: IReceipt,
    status: TerminalDeliveryStatus,
  ): void {
    receipt.ack.status = status;
    if (status !== 'unknown' && this.unresolved === receipt.ack.sequence)
      this.unresolved = null;
  }

  private assertRunning(): void {
    if (this.state !== 'running') terminalFailure(409, 'NOT_RUNNING');
  }

  private assertResolved(): void {
    if (this.unresolved !== null) terminalFailure(409, 'INPUT_UNKNOWN');
  }

  private assertWriter(writer: ITerminalWriter): void {
    assertTerminalUuid(writer.tabId);
    assertTerminalUuid(writer.token);
    if (
      !this.writer ||
      writer.tabId !== this.writer.tabId ||
      writer.token !== this.writer.token ||
      writer.writerGeneration !== this.writer.writerGeneration
    )
      terminalFailure(409, 'STALE_WRITER');
  }
}
