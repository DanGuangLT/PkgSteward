import {
  isSupportedRunnerVersion,
  SUPPORTED_RUNNER_MAJORS,
} from '@/npm-runner/toolchain/runner-version-policy';

describe('runner version policy', () => {
  it('exports the finite supported majors', () => {
    expect(SUPPORTED_RUNNER_MAJORS).toEqual({ npm: [11, 12], pnpm: [11] });
  });

  it.each([
    ['npm', '11.17.0'],
    ['npm', '12.0.0'],
    ['npm', '12.2.2'],
    ['pnpm', '11.22.0'],
    ['npm', '11.0.0-pre.1'],
    ['pnpm', '11.0.0-pre.1'],
    ['npm', '11.17.0+TEST'],
    ['npm', '12.2.2+TEST'],
  ])(
    'supports %s %s (retaining major 11 prerelease/build behavior)',
    (manager, version) => {
      expect(isSupportedRunnerVersion(manager, version)).toBe(true);
    },
  );

  it.each([
    ['npm', '10.9.0'],
    ['npm', '13.0.0'],
    ['pnpm', '12.0.0'],
    ['yarn', '11.17.0'],
    ['unknown', '12.2.2'],
    ['toString', '11.17.0'],
    ['npm', ''],
    ['npm', 'invalid'],
    ['npm', '12'],
    ['npm', '^12.2.2'],
    ['npm', '012.2.2'],
    ['npm', 'v11.17.0'],
    ['npm', 'v12.2.2'],
    ['npm', ' 12.2.2 '],
    ['npm', '12.0.0-pre.1'],
    ['npm', '12.2.2-rc.1+TEST'],
  ])('refuses %s %p', (manager, version) => {
    expect(isSupportedRunnerVersion(manager, version)).toBe(false);
  });
});
