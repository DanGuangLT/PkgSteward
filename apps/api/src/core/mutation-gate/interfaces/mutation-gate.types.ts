export interface IMutationGateService {
  isBusy(): boolean;
  tryEnter(): symbol | null;
  leave(token: symbol): void;
  assertIdle(): void;
}
