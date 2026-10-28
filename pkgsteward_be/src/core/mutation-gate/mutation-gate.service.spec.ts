import { AppException } from '@/common/exceptions/app.exception';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';

describe('MutationGateService', () => {
  it('starts idle and acquires a symbol token synchronously', () => {
    const gate = new MutationGateService();
    expect(gate.isBusy()).toBe(false);
    expect(typeof gate.tryEnter()).toBe('symbol');
    expect(gate.isBusy()).toBe(true);
  });

  it('refuses a second acquisition without releasing the current owner', () => {
    const gate = new MutationGateService();
    gate.tryEnter();
    expect(gate.tryEnter()).toBeNull();
    expect(gate.isBusy()).toBe(true);
  });

  it('ignores a foreign token', () => {
    const gate = new MutationGateService();
    gate.tryEnter();
    gate.leave(Symbol('foreign'));
    expect(gate.isBusy()).toBe(true);
    expect(gate.tryEnter()).toBeNull();
  });

  it('releases only the matching token and tolerates repeated release', () => {
    const gate = new MutationGateService();
    const token = gate.tryEnter()!;
    gate.leave(token);
    expect(gate.isBusy()).toBe(false);
    expect(() => gate.leave(token)).not.toThrow();
    expect(gate.isBusy()).toBe(false);
  });

  it('issues a fresh token so an old owner cannot release a new acquisition', () => {
    const gate = new MutationGateService();
    const first = gate.tryEnter()!;
    gate.leave(first);
    const second = gate.tryEnter()!;
    expect(typeof second).toBe('symbol');
    expect(second).not.toBe(first);
    gate.leave(first);
    expect(gate.isBusy()).toBe(true);
    gate.leave(second);
    expect(gate.isBusy()).toBe(false);
  });

  it('allows idle assertions before acquisition and after release', () => {
    const gate = new MutationGateService();
    expect(() => gate.assertIdle()).not.toThrow();
    const token = gate.tryEnter()!;
    gate.leave(token);
    expect(() => gate.assertIdle()).not.toThrow();
  });

  it('throws the documented conflict while held without releasing ownership', () => {
    const gate = new MutationGateService();
    gate.tryEnter();
    let thrown: unknown;
    try {
      gate.assertIdle();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppException);
    expect(thrown).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'A file operation is in progress',
    });
    expect(gate.isBusy()).toBe(true);
  });
});
