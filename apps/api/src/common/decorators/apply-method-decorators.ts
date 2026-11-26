/**
 * Composes multiple method decorators into a single `MethodDecorator`.
 *
 * Avoids `@nestjs/common`'s `applyDecorators` union return type in 12.6.3+
 * (`Function | TypedPropertyDescriptor<Y> | undefined`), which triggers
 * TS1270 under TypeScript 6 when applied to class methods.
 */
export const applyMethodDecorators = (
  ...decorators: readonly MethodDecorator[]
): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    let current = descriptor;
    for (const decorator of decorators) {
      const result = decorator(target, propertyKey, current);
      if (result !== undefined) {
        current = result;
      }
    }
    return current;
  };
};
