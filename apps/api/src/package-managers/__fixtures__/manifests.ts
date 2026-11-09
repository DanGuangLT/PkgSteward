// TEST data only: không phải yêu cầu nghiệp vụ. No runtime filesystem/tool access.
export const MANIFEST_EDITS = [
  {
    name: 'LF',
    before: '{\n  "name": "TEST",\n  "packageManager": "npm@11.16.0"\n}\n',
    after: '{\n  "name": "TEST",\n  "packageManager": "npm@11.17.0"\n}\n',
  },
  {
    name: 'BOM and CRLF',
    before:
      '\uFEFF{\r\n  "packageManager": "npm@11.16.0",\r\n  "name": "TEST"\r\n}\r\n',
    after:
      '\uFEFF{\r\n  "packageManager": "npm@11.17.0",\r\n  "name": "TEST"\r\n}\r\n',
  },
  {
    name: 'compact',
    before: '{"name":"TEST","packageManager":"npm@11.16.0","x":[1,true,null]}',
    after: '{"name":"TEST","packageManager":"npm@11.17.0","x":[1,true,null]}',
  },
  {
    name: 'four spaces',
    before: '{\n    "name": "TEST"\n}\n',
    after: '{\n    "name": "TEST",\n    "packageManager": "npm@11.17.0"\n}\n',
  },
  {
    name: 'tab indent and CRLF insertion',
    before: '{\r\n\t"name": "TEST"\r\n}\r\n',
    after:
      '{\r\n\t"name": "TEST",\r\n\t"packageManager": "npm@11.17.0"\r\n}\r\n',
  },
  {
    name: 'compact insertion',
    before: '{"name":"TEST"}',
    after: '{"name":"TEST","packageManager":"npm@11.17.0"}',
  },
  {
    name: 'empty compact',
    before: '{}',
    after: '{"packageManager":"npm@11.17.0"}',
  },
  {
    name: 'empty multiline',
    before: '{\n}\n',
    after: '{\n  "packageManager": "npm@11.17.0"\n}\n',
  },
  {
    name: 'empty BOM and CRLF',
    before: '\uFEFF{\r\n}\r\n',
    after: '\uFEFF{\r\n  "packageManager": "npm@11.17.0"\r\n}\r\n',
  },
  {
    name: 'escaped root key and string',
    before:
      '{"package\\u004danager":"npm\\u004011.16.0","x":"braces } { and \\\\u263a"}',
    after:
      '{"package\\u004danager":"npm@11.17.0","x":"braces } { and \\\\u263a"}',
  },
  {
    name: 'nested pin ignored',
    before: '{"nested":{"packageManager":"yarn@1.22.22"},"name":"TEST"}',
    after:
      '{"nested":{"packageManager":"yarn@1.22.22"},"name":"TEST","packageManager":"npm@11.17.0"}',
  },
  {
    name: 'Unicode byte offsets',
    before:
      '{"name":"TEST tiếng Việt 😀","packageManager":"npm@11.16.0","z":"é"}\n',
    after:
      '{"name":"TEST tiếng Việt 😀","packageManager":"npm@11.17.0","z":"é"}\n',
  },
  {
    name: 'preserve padding',
    before: ' \t{"name": "TEST"  }\r\n ',
    after: ' \t{"name": "TEST","packageManager": "npm@11.17.0"  }\r\n ',
  },
] as const;
