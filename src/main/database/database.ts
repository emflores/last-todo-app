import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations';

export function migrationRecoveryPath(
  databasePath: string,
  fromVersion: number,
  toVersion = CURRENT_SCHEMA_VERSION,
): string {
  const extension = path.extname(databasePath);
  const name = path.basename(databasePath, extension);
  return path.join(
    path.dirname(databasePath),
    'migration-recovery',
    `${name}-schema-v${fromVersion}-to-v${toVersion}.db`,
  );
}

function createMigrationRecovery(
  db: BetterSqlite3.Database,
  databasePath: string,
  fromVersion: number,
): void {
  if (fromVersion <= 0 || fromVersion >= CURRENT_SCHEMA_VERSION) return;
  const destination = migrationRecoveryPath(databasePath, fromVersion);
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const quoted = destination.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${quoted}'`);
}

export class AppDatabase {
  private connection: BetterSqlite3.Database;
  private writeTail: Promise<unknown> = Promise.resolve();

  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.connection = this.open();
  }

  get db(): BetterSqlite3.Database {
    return this.connection;
  }

  private open(): BetterSqlite3.Database {
    const db = new BetterSqlite3(this.filePath);
    try {
      db.pragma('foreign_keys = ON');
      db.pragma('journal_mode = WAL');
      const currentVersion = db.pragma('user_version', {
        simple: true,
      }) as number;
      createMigrationRecovery(db, this.filePath, currentVersion);
      migrate(db);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  write<T>(operation: (db: BetterSqlite3.Database) => T): Promise<T> {
    return this.serialized((db) => db.transaction(operation)(db));
  }

  serialized<T>(operation: (db: BetterSqlite3.Database) => T): Promise<T> {
    const result = this.writeTail.then(() => operation(this.connection));
    this.writeTail = result.catch(() => undefined);
    return result;
  }

  async replaceWith(snapshotPath: string): Promise<void> {
    await this.writeTail;
    this.connection.close();
    const staged = `${this.filePath}.restore`;
    const previous = `${this.filePath}.before-restore`;
    try {
      fs.copyFileSync(snapshotPath, staged);
      if (fs.existsSync(this.filePath))
        fs.copyFileSync(this.filePath, previous);
      for (const suffix of ['-wal', '-shm']) {
        const auxiliary = `${this.filePath}${suffix}`;
        if (fs.existsSync(auxiliary)) fs.unlinkSync(auxiliary);
      }
      fs.copyFileSync(staged, this.filePath);
      fs.unlinkSync(staged);
      this.connection = this.open();
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
    } catch (error) {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
      if (fs.existsSync(previous)) fs.copyFileSync(previous, this.filePath);
      this.connection = this.open();
      throw error;
    }
  }

  close(): void {
    if (this.connection.open) {
      this.connection.pragma('wal_checkpoint(TRUNCATE)');
      this.connection.close();
    }
  }
}
