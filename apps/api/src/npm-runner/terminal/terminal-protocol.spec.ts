import { parseTerminalFrame, TerminalWorkerInbox } from './terminal-protocol';

const identity = {
  jobId: '11111111-1111-4111-8111-111111111111',
  generation: 1,
};
const input = {
  ...identity,
  type: 'input',
  writerGeneration: 1,
  sequence: 1,
  text: 'y\r',
};
const init = {
  ...identity,
  type: 'init',
  file: 'C:\\node\\node.exe',
  args: ['run.js'],
  cwd: 'D:\\fixture',
  env: { PATH: 'C:\\node' },
  cols: 80,
  rows: 24,
};

describe('terminal IPC boundary', () => {
  it.each([
    { field: 'file', path: '/node.exe' },
    { field: 'cwd', path: '/fixture' },
    { field: 'file', path: '\\node.exe' },
    { field: 'cwd', path: '\\fixture' },
    { field: 'file', path: 'C:node.exe' },
    { field: 'cwd', path: 'D:fixture' },
  ])(
    'rejects Windows current-drive-relative $field=$path',
    ({ field, path }) => {
      expect(() =>
        parseTerminalFrame({ ...init, [field]: path }, identity, 'parent'),
      ).toThrow();
    },
  );

  it.each([
    { file: 'C:\\node\\node.exe', cwd: 'D:\\fixture' },
    { file: 'C:/node/node.exe', cwd: 'D:/fixture' },
    { file: '//server/tools/node.exe', cwd: '//server/projects/fixture' },
    {
      file: '\\\\server\\tools\\node.exe',
      cwd: '\\\\server\\projects\\fixture',
    },
  ])('retains fully qualified Windows init authority %#', (paths) => {
    expect(
      parseTerminalFrame({ ...init, ...paths }, identity, 'parent'),
    ).toMatchObject(paths);
  });

  it('accepts only the expected direction and job generation', () => {
    expect(parseTerminalFrame(input, identity, 'parent')).toEqual(input);
    expect(() => parseTerminalFrame(input, identity, 'worker')).toThrow();
    expect(() =>
      parseTerminalFrame({ ...input, generation: 2 }, identity, 'parent'),
    ).toThrow();
    expect(() =>
      parseTerminalFrame(
        { ...input, jobId: '22222222-2222-4222-8222-222222222222' },
        identity,
        'parent',
      ),
    ).toThrow();
  });

  it.each([
    null,
    [],
    {},
    { ...input, type: 'shell', command: 'whoami' },
    { ...input, command: 'whoami' },
    { ...input, text: '😀'.repeat(1025) },
    { ...input, text: '\ud800' },
    { ...input, sequence: 0 },
    { ...input, sequence: 1.1 },
    { ...input, writerGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, jobId: '11111111-1111-1111-8111-111111111111' },
    { ...init, file: 'node' },
    { ...init, cwd: 'relative' },
    { ...init, file: '\\node.exe' },
    { ...init, cwd: 'C:fixture' },
    { ...init, args: ['a\0b'] },
    { ...init, args: Array(257).fill('x') },
    { ...init, args: Array(1) },
    { ...init, env: { 'BAD=KEY': 'x' } },
    { ...init, env: { PATH: 'x'.repeat(65537) } },
    { ...init, cols: 501 },
    { ...init, rows: 0 },
  ])('rejects malformed/over-authoritative frame %#', (value) => {
    expect(() => parseTerminalFrame(value, identity, 'parent')).toThrow();
  });

  it('rejects inherited/symbol authority and does not echo typed payload', () => {
    expect(() =>
      parseTerminalFrame(Object.create(input), identity, 'parent'),
    ).toThrow();
    expect(() =>
      parseTerminalFrame(
        { ...input, [Symbol('cmd')]: true },
        identity,
        'parent',
      ),
    ).toThrow();
    try {
      parseTerminalFrame(
        { ...input, text: 'secret'.repeat(4096) },
        identity,
        'parent',
      );
      throw new Error('Expected rejection');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it('refuses hidden array authority and does not execute accessor arguments', () => {
    const args = ['script.js'];
    Object.defineProperty(args, 'command', { value: 'whoami' });
    expect(() =>
      parseTerminalFrame({ ...init, args }, identity, 'parent'),
    ).toThrow();
    const accessor = ['script.js'];
    const getter = jest.fn(() => 'script.js');
    Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    expect(() =>
      parseTerminalFrame({ ...init, args: accessor }, identity, 'parent'),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('validates every worker variant and refuses oversized output/untrusted error text', () => {
    const frames = [
      {
        ...identity,
        type: 'ready',
        pid: 42,
      },
      { ...identity, type: 'output', text: 'a😀' },
      {
        ...identity,
        type: 'input-ack',
        writerGeneration: 1,
        sequence: 1,
        status: 'unknown',
      },
      { ...identity, type: 'exit', exitCode: null, signal: 'SIGTERM' },
      { ...identity, type: 'error', code: 'WORKER_FAILED' },
    ];
    for (const frame of frames)
      expect(parseTerminalFrame(frame, identity, 'worker')).toEqual(frame);
    expect(() =>
      parseTerminalFrame(
        { ...identity, type: 'output', text: '😀'.repeat(16385) },
        identity,
        'worker',
      ),
    ).toThrow();
    expect(() =>
      parseTerminalFrame(
        { ...identity, type: 'ready', pid: -1 },
        identity,
        'worker',
      ),
    ).toThrow();
    expect(() =>
      parseTerminalFrame(
        {
          ...identity,
          type: 'input-ack',
          writerGeneration: 1,
          sequence: 1,
          status: 'ok',
        },
        identity,
        'worker',
      ),
    ).toThrow();
    expect(() =>
      parseTerminalFrame(
        {
          ...identity,
          type: 'error',
          code: 'WORKER_FAILED',
          message: 'secret',
        },
        identity,
        'worker',
      ),
    ).toThrow();
  });

  it('refuses worker-supplied creation identity; parent captures it independently', () => {
    expect(() =>
      parseTerminalFrame(
        { ...identity, type: 'ready', pid: 42, creationTime: 'untrusted' },
        identity,
        'worker',
      ),
    ).toThrow();
  });

  it('requires initialization exactly once and snapshots accepted authority', () => {
    const inbox = new TerminalWorkerInbox(identity);
    expect(() => inbox.accept(input)).toThrow();
    const accepted = inbox.accept(init);
    expect(accepted).toEqual(init);
    init.args[0] = 'mutated.js';
    expect(accepted).toMatchObject({ args: ['run.js'] });
    expect(() => inbox.accept(init)).toThrow();
    expect(inbox.accept(input)).toEqual(input);
  });
});
