import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error)
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  return { value: String(error) };
}

export function rotateLogFile(
  filePath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): void {
  try {
    if (fs.statSync(filePath).size < maxBytes) return;
    const extension = path.extname(filePath);
    const stem = extension ? filePath.slice(0, -extension.length) : filePath;
    const previousPath = `${stem}.previous${extension}`;
    fs.rmSync(previousPath, { force: true });
    fs.renameSync(filePath, previousPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export class AppLogger {
  readonly filePath: string;

  constructor(
    logDirectory: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly now: () => Date = () => new Date(),
  ) {
    fs.mkdirSync(logDirectory, { recursive: true });
    this.filePath = path.join(logDirectory, 'main.log');
    rotateLogFile(this.filePath, this.maxBytes);
  }

  info(event: string, details?: object): void {
    this.write('info', event, details);
  }

  warn(event: string, details?: object): void {
    this.write('warn', event, details);
  }

  error(event: string, details?: object): void {
    this.write('error', event, details);
  }

  private write(
    level: 'info' | 'warn' | 'error',
    event: string,
    details?: object,
  ): void {
    try {
      rotateLogFile(this.filePath, this.maxBytes);
      fs.appendFileSync(
        this.filePath,
        `${JSON.stringify({
          timestamp: this.now().toISOString(),
          level,
          event,
          ...(details ? { details } : {}),
        })}\n`,
        'utf8',
      );
    } catch (error) {
      console.error('Could not write LastTodo diagnostic log:', error);
    }
  }
}
