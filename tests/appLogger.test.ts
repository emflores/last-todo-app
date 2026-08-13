import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AppLogger, describeError } from '../src/main/services/appLogger';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function logDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lasttodo-logs-'));
  directories.push(directory);
  return directory;
}

describe('application diagnostics logger', () => {
  it('writes structured JSON lines', () => {
    const logger = new AppLogger(
      logDirectory(),
      10_000,
      () => new Date('2026-08-12T20:00:00.000Z'),
    );

    logger.error('renderer-process-gone', {
      reason: 'crashed',
      exitCode: 139,
    });

    expect(JSON.parse(fs.readFileSync(logger.filePath, 'utf8').trim())).toEqual(
      {
        timestamp: '2026-08-12T20:00:00.000Z',
        level: 'error',
        event: 'renderer-process-gone',
        details: { reason: 'crashed', exitCode: 139 },
      },
    );
  });

  it('rotates an oversized log and keeps one previous file', () => {
    const directory = logDirectory();
    const logger = new AppLogger(directory, 1);
    logger.info('first');
    logger.info('second');

    expect(fs.readFileSync(logger.filePath, 'utf8')).toContain('second');
    expect(
      fs.readFileSync(path.join(directory, 'main.previous.log'), 'utf8'),
    ).toContain('first');
  });

  it('serializes errors without losing their diagnostic fields', () => {
    const details = describeError(new TypeError('database failed'));
    expect(details).toMatchObject({
      name: 'TypeError',
      message: 'database failed',
    });
    expect(details.stack).toContain('database failed');
  });
});
