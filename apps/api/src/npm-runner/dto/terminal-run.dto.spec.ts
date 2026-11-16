import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  TerminalClaimDto,
  TerminalInputAckDto,
  TerminalInputDto,
  TerminalOutputQueryDto,
  TerminalResizeDto,
} from '@/npm-runner/dto/terminal-run.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };
const uuid1 = '00000000-0000-4000-8000-000000000001';
const uuid2 = '00000000-0000-4000-8000-000000000002';
const uuid3 = '00000000-0000-4000-8000-000000000003';

describe('Terminal DTO admission boundary', () => {
  describe('TerminalOutputQueryDto', () => {
    it.each([
      [{ generation: 1 }, { generation: 1, cursor: 0 }],
      [
        { generation: '1', cursor: '0' },
        { generation: 1, cursor: 0 },
      ],
      [
        { generation: '3', cursor: String(Number.MAX_SAFE_INTEGER) },
        { generation: 3, cursor: Number.MAX_SAFE_INTEGER },
      ],
    ])('accepts valid query %p', (raw, expected) => {
      const dto = plainToInstance(TerminalOutputQueryDto, raw);
      expect(validateSync(dto, options)).toEqual([]);
      expect(dto).toMatchObject(expected);
    });

    it.each([
      {},
      { generation: 0, cursor: 0 },
      { generation: -1, cursor: 0 },
      { generation: '0', cursor: '0' },
      { generation: '1e2', cursor: '0' },
      { generation: ' 1', cursor: '0' },
      { generation: 1, cursor: -1 },
      { generation: 1, cursor: '0x10' },
      { generation: 1, cursor: Number.MAX_SAFE_INTEGER + 1 },
      { generation: 1, cursor: 0, extra: 1 },
    ])('rejects invalid query %p', (raw) => {
      const dto = plainToInstance(TerminalOutputQueryDto, raw);
      expect(validateSync(dto, options)).not.toEqual([]);
    });
  });

  describe('TerminalClaimDto', () => {
    it('accepts exact UUIDv4 fields and boolean takeover', () => {
      const dto = plainToInstance(TerminalClaimDto, {
        requestId: uuid1,
        generation: 1,
        tabId: uuid2,
        takeover: false,
      });
      expect(validateSync(dto, options)).toEqual([]);
    });

    it.each([
      { requestId: 'bad', generation: 1, tabId: uuid2, takeover: false },
      {
        requestId: uuid1,
        generation: 0,
        tabId: uuid2,
        takeover: false,
      },
      {
        requestId: uuid1,
        generation: '1',
        tabId: uuid2,
        takeover: false,
      },
      { requestId: uuid1, generation: 1, tabId: 'not-v4', takeover: false },
      { requestId: uuid1, generation: 1, tabId: uuid2, takeover: 'true' },
      {
        requestId: uuid1,
        generation: 1,
        tabId: uuid2,
        takeover: true,
        extra: true,
      },
    ])('rejects invalid claim payload %p', (raw) => {
      expect(
        validateSync(plainToInstance(TerminalClaimDto, raw), options),
      ).not.toEqual([]);
    });
  });

  describe('TerminalInputDto & TerminalInputAckDto', () => {
    const validAck = {
      requestId: uuid1,
      generation: 1,
      tabId: uuid2,
      token: uuid3,
      writerGeneration: 1,
      sequence: 1,
    };

    it('accepts valid ack and input payloads including Ctrl+C and max 4096 ASCII bytes', () => {
      expect(
        validateSync(plainToInstance(TerminalInputAckDto, validAck), options),
      ).toEqual([]);
      expect(
        validateSync(
          plainToInstance(TerminalInputDto, { ...validAck, text: '\u0003' }),
          options,
        ),
      ).toEqual([]);
      expect(
        validateSync(
          plainToInstance(TerminalInputDto, {
            ...validAck,
            text: 'a'.repeat(4096),
          }),
          options,
        ),
      ).toEqual([]);
    });

    it.each([
      { ...validAck, sequence: 0 },
      { ...validAck, writerGeneration: 0 },
      { ...validAck, token: '00000000-0000-1000-8000-000000000003' },
      { ...validAck, extra: 'x' },
    ])('rejects invalid ack payload %p', (raw) => {
      expect(
        validateSync(plainToInstance(TerminalInputAckDto, raw), options),
      ).not.toEqual([]);
    });

    it.each([
      { ...validAck, text: '' },
      { ...validAck, text: 'a'.repeat(4097) },
      { ...validAck, text: '😀'.repeat(1025) },
      { ...validAck, text: '\ud800' },
      { ...validAck, text: 123 },
      { ...validAck, text: 'y\r', extra: true },
    ])('rejects invalid input text payload', (raw) => {
      expect(
        validateSync(plainToInstance(TerminalInputDto, raw), options),
      ).not.toEqual([]);
    });
  });

  describe('TerminalResizeDto', () => {
    const validResize = {
      requestId: uuid1,
      generation: 1,
      tabId: uuid2,
      token: uuid3,
      writerGeneration: 1,
      cols: 80,
      rows: 24,
    };

    it('accepts bounds 2..500 cols and 1..300 rows', () => {
      expect(
        validateSync(
          plainToInstance(TerminalResizeDto, {
            ...validResize,
            cols: 2,
            rows: 1,
          }),
          options,
        ),
      ).toEqual([]);
      expect(
        validateSync(
          plainToInstance(TerminalResizeDto, {
            ...validResize,
            cols: 500,
            rows: 300,
          }),
          options,
        ),
      ).toEqual([]);
    });

    it.each([
      { ...validResize, cols: 1 },
      { ...validResize, cols: 501 },
      { ...validResize, rows: 0 },
      { ...validResize, rows: 301 },
      { ...validResize, cols: 80.5 },
      { ...validResize, extra: 1 },
    ])('rejects invalid resize payload %p', (raw) => {
      expect(
        validateSync(plainToInstance(TerminalResizeDto, raw), options),
      ).not.toEqual([]);
    });
  });
});
