import { Injectable } from '@nestjs/common';
import { AppException } from '@/common/exceptions/app.exception';
import type { IMutationGateService } from '@/core/mutation-gate/interfaces/mutation-gate.types';

@Injectable()
export class MutationGateService implements IMutationGateService {
  private owner: symbol | null = null;

  isBusy(): boolean {
    return this.owner !== null;
  }

  tryEnter(): symbol | null {
    if (this.isBusy()) return null;
    this.owner = Symbol('mutation');
    return this.owner;
  }

  leave(token: symbol): void {
    if (this.owner === token) this.owner = null;
  }

  assertIdle(): void {
    if (this.isBusy()) {
      throw new AppException(
        409,
        'A file operation is in progress',
        'CONFLICT',
      );
    }
  }
}
