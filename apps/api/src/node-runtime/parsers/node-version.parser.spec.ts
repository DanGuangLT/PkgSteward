import {
  buildSafeManagerCommands,
  evaluateProjectNodeCompatibility,
  normalizeNodeRequirement,
  parseFnmList,
  parseNvmWindowsList,
  parseVoltaListNode,
} from '@/node-runtime/parsers/node-version.parser';
import type { INodeManagerInfo } from '@/node-runtime/interfaces/node-runtime.types';

describe('node-version.parser', () => {
  describe('parseNvmWindowsList', () => {
    it('parses active and installed versions sorted descending', () => {
      const stdout = [
        '',
        '    20.18.1',
        '  * 24.19.0 (Currently using 64-bit executable)',
        '    22.18.0',
        '    22.18.0',
      ].join('\n');

      expect(parseNvmWindowsList(stdout)).toEqual({
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '22.18.0', '20.18.1'],
      });
    });

    it('strips UTF-16LE NUL bytes, BOM, and CRLF', () => {
      const raw =
        '\uFEFF' +
        '  * 24.19.0 (Currently)\r\n  22.18.0\r\n'.split('').join('\u0000');

      expect(parseNvmWindowsList(raw)).toEqual({
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '22.18.0'],
      });
    });

    it('handles No installations recognized cleanly', () => {
      expect(parseNvmWindowsList('No installations recognized.\r\n')).toEqual({
        activeVersion: null,
        installedVersions: [],
      });
    });
  });

  describe('parseFnmList', () => {
    it('parses versions and strips leading v while ignoring system alias', () => {
      const stdout = [
        '* v20.18.1',
        '* v24.19.0 default',
        '* v22.18.0',
        '* system',
      ].join('\n');

      expect(parseFnmList(stdout)).toEqual({
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '22.18.0', '20.18.1'],
      });
    });

    it('detects active version marked with leading asterisk', () => {
      const stdout = ['  v24.19.0 default', '* v22.18.0'].join('\n');

      expect(parseFnmList(stdout)).toEqual({
        activeVersion: '22.18.0',
        installedVersions: ['24.19.0', '22.18.0'],
      });
    });
  });

  describe('parseVoltaListNode', () => {
    it('parses installed versions and prefers current over default for activeVersion', () => {
      const stdout = [
        'runtime node@22.18.0 (default)',
        'runtime node@20.19.0 (current @ D:\\Projects\\app\\package.json)',
        'runtime node@24.19.0',
      ].join('\n');

      expect(parseVoltaListNode(stdout)).toEqual({
        activeVersion: '20.19.0',
        installedVersions: ['24.19.0', '22.18.0', '20.19.0'],
      });
    });

    it('falls back to default when no current marker is present', () => {
      const stdout = 'runtime node@22.18.0 (default)\n';

      expect(parseVoltaListNode(stdout)).toEqual({
        activeVersion: '22.18.0',
        installedVersions: ['22.18.0'],
      });
    });
  });

  describe('normalizeNodeRequirement', () => {
    it('normalizes exact, partial, and range expressions and strips comments', () => {
      expect(normalizeNodeRequirement('v20 # pin major\n')).toEqual({
        normalizedRange: '>=20.0.0 <21.0.0-0',
        suggestedVersion: '20.0.0',
      });
      expect(normalizeNodeRequirement('20.11')).toEqual({
        normalizedRange: '>=20.11.0 <20.12.0-0',
        suggestedVersion: '20.11.0',
      });
      expect(normalizeNodeRequirement('20.11.1')).toEqual({
        normalizedRange: '20.11.1',
        suggestedVersion: '20.11.1',
      });
      expect(normalizeNodeRequirement('>=22.18')).toEqual({
        normalizedRange: '>=22.18.0',
        suggestedVersion: '22.18.0',
      });
      expect(normalizeNodeRequirement('^20.17.0 || >=22.9.0')).toEqual({
        normalizedRange: '>=20.17.0 <21.0.0-0||>=22.9.0',
        suggestedVersion: '20.17.0',
      });
    });

    it('returns null range and suggestion for symbolic aliases and empty strings', () => {
      for (const alias of [
        'lts/*',
        'lts/iron',
        'node',
        'latest',
        '',
        '   # only comment',
      ]) {
        expect(normalizeNodeRequirement(alias)).toEqual({
          normalizedRange: null,
          suggestedVersion: null,
        });
      }
    });
  });

  describe('buildSafeManagerCommands', () => {
    const managers: INodeManagerInfo[] = [
      {
        id: 'nvm-windows',
        label: 'nvm-windows',
        detected: true,
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '20.18.1'],
      },
      {
        id: 'fnm',
        label: 'fnm',
        detected: true,
        activeVersion: null,
        installedVersions: ['22.18.0'],
      },
      {
        id: 'volta',
        label: 'Volta',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
    ];

    it('rejects any shell metacharacter or non-numeric version input', () => {
      for (const unsafe of [
        null,
        '',
        'v20.0.0',
        '20.0.0 && calc.exe',
        '`whoami`',
        '20;del',
        '20.0.0 | dir',
        '20.0.0\nwhoami',
      ]) {
        expect(buildSafeManagerCommands(unsafe, managers)).toEqual([]);
      }
    });

    it('builds safe install and switch commands only for detected managers', () => {
      expect(buildSafeManagerCommands('20.18.1', managers)).toEqual([
        {
          managerId: 'nvm-windows',
          managerLabel: 'nvm-windows',
          targetVersion: '20.18.1',
          alreadyInstalled: true,
          installCommand: null,
          switchCommand: 'nvm use 20.18.1',
        },
        {
          managerId: 'fnm',
          managerLabel: 'fnm',
          targetVersion: '20.18.1',
          alreadyInstalled: false,
          installCommand: 'fnm install 20.18.1',
          switchCommand: 'fnm use 20.18.1',
        },
      ]);
    });

    it('builds volta install and pin commands when volta is detected', () => {
      const voltaOnly: INodeManagerInfo[] = [
        {
          id: 'volta',
          label: 'Volta',
          detected: true,
          activeVersion: '24.19.0',
          installedVersions: ['24.19.0'],
        },
      ];

      expect(buildSafeManagerCommands('22.18.0', voltaOnly)).toEqual([
        {
          managerId: 'volta',
          managerLabel: 'Volta',
          targetVersion: '22.18.0',
          alreadyInstalled: false,
          installCommand: 'volta install node@22.18.0',
          switchCommand: 'volta pin node@22.18.0',
        },
      ]);
    });
  });

  describe('evaluateProjectNodeCompatibility', () => {
    const managers: INodeManagerInfo[] = [
      {
        id: 'nvm-windows',
        label: 'nvm-windows',
        detected: true,
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '20.18.1'],
      },
    ];

    it('returns undeclared when no requirements exist', () => {
      expect(
        evaluateProjectNodeCompatibility({
          projectPath: 'D:\\Projects\\app',
          projectName: 'app',
          activeVersion: '24.19.0',
          requirements: [],
          installedVersions: ['24.19.0', '20.18.1'],
          managers,
        }),
      ).toEqual({
        path: 'D:\\Projects\\app',
        name: 'app',
        status: 'undeclared',
        activeNodeVersion: '24.19.0',
        effectiveRequirement: null,
        requirements: [],
        matchedInstalledVersion: null,
        suggestedVersion: null,
        commands: [],
      });
    });

    it('applies precedence .nvmrc > .node-version > package.json#engines.node and evaluates mismatch', () => {
      const result = evaluateProjectNodeCompatibility({
        projectPath: 'D:\\Projects\\legacy',
        projectName: 'legacy',
        activeVersion: '24.19.0',
        requirements: [
          {
            source: 'package.json#engines.node',
            raw: '>=22.0.0',
            ...normalizeNodeRequirement('>=22.0.0'),
          },
          {
            source: '.node-version',
            raw: '22.18.0',
            ...normalizeNodeRequirement('22.18.0'),
          },
          {
            source: '.nvmrc',
            raw: 'v20',
            ...normalizeNodeRequirement('v20'),
          },
        ],
        installedVersions: ['24.19.0', '20.18.1'],
        managers,
      });

      expect(result.status).toBe('mismatch');
      expect(result.effectiveRequirement?.source).toBe('.nvmrc');
      expect(result.matchedInstalledVersion).toBe('20.18.1');
      expect(result.suggestedVersion).toBe('20.18.1');
      expect(result.commands).toEqual([
        {
          managerId: 'nvm-windows',
          managerLabel: 'nvm-windows',
          targetVersion: '20.18.1',
          alreadyInstalled: true,
          installCommand: null,
          switchCommand: 'nvm use 20.18.1',
        },
      ]);
    });

    it('returns compatible with empty commands when active Node satisfies effective requirement', () => {
      const result = evaluateProjectNodeCompatibility({
        projectPath: 'D:\\Projects\\modern',
        projectName: 'modern',
        activeVersion: '24.19.0',
        requirements: [
          {
            source: 'package.json#engines.node',
            raw: '>=22.18',
            ...normalizeNodeRequirement('>=22.18'),
          },
        ],
        installedVersions: ['24.19.0'],
        managers,
      });

      expect(result.status).toBe('compatible');
      expect(result.matchedInstalledVersion).toBe('24.19.0');
      expect(result.commands).toEqual([]);
    });

    it('returns unknown when effective requirement is a symbolic alias', () => {
      const result = evaluateProjectNodeCompatibility({
        projectPath: 'D:\\Projects\\lts-app',
        projectName: 'lts-app',
        activeVersion: '24.19.0',
        requirements: [
          {
            source: '.nvmrc',
            raw: 'lts/*',
            ...normalizeNodeRequirement('lts/*'),
          },
        ],
        installedVersions: ['24.19.0'],
        managers,
      });

      expect(result.status).toBe('unknown');
      expect(result.suggestedVersion).toBeNull();
      expect(result.commands).toEqual([]);
    });
  });
});
