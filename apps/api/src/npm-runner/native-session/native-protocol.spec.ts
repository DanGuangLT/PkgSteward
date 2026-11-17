import {
  NATIVE_LIMITS,
  NativeCommandSequence,
  parseCoordinatorToSupervisorFrame,
  parseSupervisorToBridgeFrame,
  parseBridgeToSupervisorFrame,
  parseSupervisorToCoordinatorFrame,
  sanitizeInitialEnv,
} from './native-protocol';

const identity = {
  jobId: '00000000-0000-4000-8000-000000000001',
  generation: 1,
};
const frame = (type: string, fields: object = {}) => ({
  ...identity,
  type,
  ...fields,
});
const init = () =>
  frame('init', {
    initialFile: 'C:\\node\\node.exe',
    initialArgs: ['C:\\npm\\npm.js', 'install'],
    cwd: 'D:\\TEST',
    env: { Path: 'C:\\Windows' },
    shell: 'cmd',
    shellFile: 'C:\\Windows\\System32\\cmd.exe',
    shellArgs: ['/d'],
    shellEnv: { USERPROFILE: 'C:\\Users\\TEST' },
  });

describe('native session protocol', () => {
  it('parses all coordinator commands and distinguishes the bridge command boundary', () => {
    for (const raw of [
      frame('spawn-bridge', { execPath: 'C:\\node.exe' }),
      init(),
      frame('open-shell-go'),
      frame('stop'),
    ])
      expect(parseCoordinatorToSupervisorFrame(raw, identity)).toEqual(raw);
    expect(() =>
      parseSupervisorToBridgeFrame(
        frame('spawn-bridge', { execPath: 'C:\\node.exe' }),
        identity,
      ),
    ).toThrow();
    expect(parseSupervisorToBridgeFrame(init(), identity)).toEqual(init());
  });
  it('parses supervisor envelopes separately from bridge payloads', () => {
    const bridgeFrames = [
      frame('bridge-ready', { pid: 12 }),
      frame('initial-spawned', { pid: 13 }),
      frame('initial-result', { exitCode: 0, signal: null }),
      frame('shell-spawned', { pid: 14 }),
      frame('session-exit', { exitCode: null, signal: 'SIGTERM' }),
      frame('bridge-error', { code: 'START_FAILED', message: 'TEST' }),
    ];
    for (const raw of bridgeFrames) {
      expect(parseBridgeToSupervisorFrame(raw, identity)).toEqual(raw);
      expect(() => parseSupervisorToCoordinatorFrame(raw, identity)).toThrow();
      expect(
        parseSupervisorToCoordinatorFrame(
          frame('bridge-frame', { payload: raw }),
          identity,
        ),
      ).toEqual(frame('bridge-frame', { payload: raw }));
    }
    for (const raw of [
      frame('supervisor-ready'),
      frame('bridge-spawned', { pid: 12 }),
      frame('bridge-exit', { exitCode: 0, signal: null }),
      frame('supervisor-error', { code: 'PROTOCOL_ERROR', message: 'TEST' }),
    ]) {
      expect(parseSupervisorToCoordinatorFrame(raw, identity)).toEqual(raw);
      expect(() => parseBridgeToSupervisorFrame(raw, identity)).toThrow();
    }
  });
  it.each([
    null,
    [],
    'TEST',
    frame('stdin', { text: 'echo TEST' }),
    frame('stop', { extra: true }),
    frame('stop', { generation: 0 }),
    frame('stop', { generation: 1.5 }),
    frame('stop', { generation: 2 ** 31 }),
    frame('stop', { generation: 2 }),
    frame('stop', { jobId: '00000000-0000-4000-8000-000000000002' }),
    frame('stop', { jobId: 'bad' }),
  ])('rejects malformed, unknown and wrong-identity commands %p', (raw) => {
    expect(() => parseCoordinatorToSupervisorFrame(raw, identity)).toThrow();
  });
  it('rejects malformed env/args, invalid UTF-8 scalars and excessive byte payloads', () => {
    const sparse = new Array<string>(1);
    const extendedArgs = Object.assign(['TEST'], { extra: true });
    const accessor = Object.defineProperty({}, 'Path', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute');
      },
    });
    const invalid = [
      { shell: 'pwsh' },
      { initialFile: 'relative' },
      { shellFile: 'C:\\bad\0.exe' },
      { initialArgs: sparse },
      { initialArgs: extendedArgs },
      { initialArgs: [1] },
      { initialArgs: ['\ud800'] },
      { initialArgs: ['é'.repeat(NATIVE_LIMITS.maxArgBytes)] },
      { env: accessor },
      { env: { key: undefined } },
      { env: { 'bad=key': 'v' } },
      { env: { constructor: 'v' } },
      { env: { BAD: '\udfff' } },
      { env: { Path: 'C:\\Windows', PATH: 'D:\\Other' } },
      {
        env: Object.fromEntries(
          Array.from({ length: NATIVE_LIMITS.maxEnvEntries + 1 }, (_, i) => [
            `KEY${i}`,
            'v',
          ]),
        ),
      },
      { env: { BIG: 'x'.repeat(NATIVE_LIMITS.maxEnvBytes + 1) } },
      { shellEnv: { K: '\0' } },
    ];
    for (const fields of invalid)
      expect(() =>
        parseCoordinatorToSupervisorFrame({ ...init(), ...fields }, identity),
      ).toThrow();
    expect(() =>
      parseCoordinatorToSupervisorFrame(
        Object.assign(Object.create({}), frame('stop')),
        identity,
      ),
    ).toThrow();
    expect(() =>
      parseCoordinatorToSupervisorFrame(
        { ...frame('stop'), [Symbol('extra')]: 1 },
        identity,
      ),
    ).toThrow();
  });
  it('accepts large bounded environments and strips IPC state case-insensitively while preserving compat', () => {
    const raw = {
      ...init(),
      env: {
        BIG: 'é'.repeat(40000),
        node_channel_extra: 'TEST',
        NODE_OPTIONS: '--inspect',
        PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'TEST',
      },
      shellEnv: {
        BIG: 'é'.repeat(40000),
        NPM_TOKEN: 'TEST',
        CI: '1',
        PKGSTEWARD_PRIVATE: 'TEST',
        node_channel_extra: 'TEST',
      },
    };
    const parsed = parseCoordinatorToSupervisorFrame(raw, identity);
    expect(parsed).toMatchObject({
      env: {
        BIG: 'é'.repeat(40000),
        PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'TEST',
      },
      shellEnv: { BIG: 'é'.repeat(40000) },
    });
    if (parsed.type !== 'init') throw new Error('TEST expected init');
    expect(Object.keys(parsed.env)).toEqual([
      'BIG',
      'PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT',
    ]);
    expect(Object.keys(parsed.shellEnv)).toEqual(['BIG']);
    expect(
      sanitizeInitialEnv({
        NODE_CHANNEL_FD: '5',
        Node_Channel_custom: '5',
        TEST: '',
      }),
    ).toEqual({ TEST: '' });
  });
  it('bounds escaped frame bytes without invoking raw toJSON or getters', () => {
    const oversized = {
      ...init(),
      env: { BIG: '\u0001'.repeat(200000) },
      shellEnv: { BIG: '\u0001'.repeat(200000) },
    };
    expect(() =>
      parseCoordinatorToSupervisorFrame(oversized, identity),
    ).toThrow();
    const toJSON = jest.fn(() => frame('stop'));
    expect(() =>
      parseCoordinatorToSupervisorFrame({ ...frame('stop'), toJSON }, identity),
    ).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
  });
  it('rejects proxy objects without invoking their traps and accepts well-formed Unicode', () => {
    const trap = jest.fn(() => Object.prototype);
    expect(() =>
      parseCoordinatorToSupervisorFrame(
        new Proxy(frame('stop'), { getPrototypeOf: trap }),
        identity,
      ),
    ).toThrow();
    expect(trap).not.toHaveBeenCalled();
    expect(() =>
      parseCoordinatorToSupervisorFrame(
        { ...init(), initialArgs: new Proxy(['TEST'], {}) },
        identity,
      ),
    ).toThrow();
    expect(() =>
      sanitizeInitialEnv(new Proxy({ TEST: 'value' }, {})),
    ).toThrow();
    expect(
      parseCoordinatorToSupervisorFrame(
        { ...init(), initialArgs: ['Tiếng Việt 😀'] },
        identity,
      ),
    ).toMatchObject({ initialArgs: ['Tiếng Việt 😀'] });
  });
  it('rejects malformed supervisor and bridge fields without permitting nested envelope forgery', () => {
    for (const raw of [
      frame('bridge-ready', { pid: 0 }),
      frame('initial-result', { exitCode: 0.1, signal: null }),
      frame('session-exit', { exitCode: 0, signal: '' }),
      frame('bridge-error', { code: 'UNKNOWN', message: 'TEST' }),
      frame('bridge-error', {
        code: 'START_FAILED',
        message: 'x'.repeat(4097),
      }),
    ])
      expect(() => parseBridgeToSupervisorFrame(raw, identity)).toThrow();
    expect(() =>
      parseSupervisorToCoordinatorFrame(
        frame('bridge-frame', { payload: frame('supervisor-ready') }),
        identity,
      ),
    ).toThrow();
  });
  it('enforces command order and rejects duplicates after each barrier', () => {
    const sequence = new NativeCommandSequence(identity);
    expect(() => sequence.accept(init())).toThrow();
    sequence.accept(frame('spawn-bridge', { execPath: 'C:\\node.exe' }));
    expect(() =>
      sequence.accept(frame('spawn-bridge', { execPath: 'C:\\node.exe' })),
    ).toThrow();
    expect(() => sequence.accept(frame('open-shell-go'))).toThrow();
    sequence.accept(init());
    expect(() => sequence.accept(init())).toThrow();
    sequence.accept(frame('open-shell-go'));
    expect(() => sequence.accept(frame('open-shell-go'))).toThrow();
    sequence.accept(frame('stop'));
    expect(() => sequence.accept(init())).toThrow();
    expect(() => sequence.accept(frame('stop'))).toThrow();
  });
});
