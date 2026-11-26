import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';
import { applyMethodDecorators } from '@/common/decorators/apply-method-decorators';

const ORDER_META_FIRST = 'test:first';
const ORDER_META_SECOND = 'test:second';

describe('applyMethodDecorators', () => {
  it('applies all composed decorators in order and attaches metadata from each', () => {
    const callOrder: string[] = [];

    const recordAndSetMetadata =
      (label: string, key: string, value: string): MethodDecorator =>
      (target, propertyKey, descriptor) => {
        callOrder.push(label);
        const setMeta: MethodDecorator = SetMetadata(key, value);
        return setMeta(target, propertyKey, descriptor);
      };

    const composed: MethodDecorator = applyMethodDecorators(
      recordAndSetMetadata('first', ORDER_META_FIRST, 'alpha'),
      recordAndSetMetadata('second', ORDER_META_SECOND, 'beta'),
    );

    class SampleController {
      @composed
      handle(this: void): string {
        return 'ok';
      }
    }

    expect(callOrder).toEqual(['first', 'second']);
    expect(
      Reflect.getMetadata(ORDER_META_FIRST, SampleController.prototype.handle),
    ).toBe('alpha');
    expect(
      Reflect.getMetadata(ORDER_META_SECOND, SampleController.prototype.handle),
    ).toBe('beta');
  });

  it('passes a replaced descriptor to subsequent decorators and applies the final descriptor', () => {
    let firstReplacement: PropertyDescriptor | undefined;
    let seenBySecond: PropertyDescriptor | undefined;
    let finalReplacement: PropertyDescriptor | undefined;

    const makeNonEnumerable: MethodDecorator = (
      _target,
      _propertyKey,
      descriptor,
    ) => {
      const next = { ...descriptor, enumerable: false };
      firstReplacement = next;
      return next;
    };

    const observeThenFreeze: MethodDecorator = (
      _target,
      _propertyKey,
      descriptor,
    ) => {
      seenBySecond = descriptor;
      const next = { ...descriptor, writable: false };
      finalReplacement = next;
      return next;
    };

    class DescriptorSample {
      @applyMethodDecorators(makeNonEnumerable, observeThenFreeze)
      greet(this: void): string {
        return 'hello';
      }
    }

    expect(firstReplacement).toBeDefined();
    expect(finalReplacement).toBeDefined();
    expect(seenBySecond).toBe(firstReplacement);
    expect(seenBySecond?.enumerable).toBe(false);

    const applied = Object.getOwnPropertyDescriptor(
      DescriptorSample.prototype,
      'greet',
    );
    expect(applied?.enumerable).toBe(false);
    expect(applied?.writable).toBe(false);
  });
});
