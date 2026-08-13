import fs from 'node:fs';
import path from 'node:path';
import type { BackupStatus } from '../../shared/contracts';
import { AppDatabase } from '../database/database';
import { SettingsStore } from './settingsStore';

const HOUR = 60 * 60 * 1000;
const SNAPSHOT_PATTERN =
  /^todos-(daily|hourly)-(\d{4}-\d{2}-\d{2})(?:T(\d{2})-(\d{2})-(\d{2}))?\.db$/;

const pad = (value: number) => String(value).padStart(2, '0');
const localDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function snapshotTime(fileName: string): number | null {
  const match = SNAPSHOT_PATTERN.exec(fileName);
  if (!match) return null;
  const [year = 0, month = 1, day = 1] = match[2]!.split('-').map(Number);
  return new Date(
    year,
    month - 1,
    day,
    Number(match[3] ?? 0),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  ).getTime();
}

export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  private state: Omit<BackupStatus, 'folder' | 'backupDirectory'> = {
    lastBackupAt: null,
    lastBackupPath: null,
    lastError: null,
  };

  constructor(
    private readonly database: AppDatabase,
    private readonly settings: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static findNewest(folder: string | null): string | null {
    if (!folder) return null;
    const directory = path.join(folder, 'backups');
    if (!fs.existsSync(directory)) return null;
    return (
      fs
        .readdirSync(directory)
        .map((fileName) => ({ fileName, time: snapshotTime(fileName) }))
        .filter(
          (entry): entry is { fileName: string; time: number } =>
            entry.time !== null,
        )
        .sort((a, b) => b.time - a.time)
        .map((entry) => path.join(directory, entry.fileName))[0] ?? null
    );
  }

  static restoreOnFreshInstall(
    databasePath: string,
    folder: string | null,
  ): string | null {
    if (fs.existsSync(databasePath)) return null;
    const snapshot = BackupService.findNewest(folder);
    if (!snapshot) return null;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.copyFileSync(snapshot, databasePath);
    return snapshot;
  }

  status(): BackupStatus {
    const folder = this.settings.backupFolder;
    return {
      folder,
      backupDirectory: folder ? path.join(folder, 'backups') : null,
      ...this.state,
    };
  }

  async chooseFolder(): Promise<BackupStatus> {
    // Loaded only when the UI action is invoked, keeping the backup engine usable in headless tests.
    const { dialog } = await import('electron');
    const selection = await dialog.showOpenDialog({
      title: 'Choose backup folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!selection.canceled && selection.filePaths[0]) {
      this.settings.setBackupFolder(selection.filePaths[0]);
      await this.runNow();
    }
    return this.status();
  }

  async runNow(): Promise<BackupStatus> {
    const folder = this.settings.backupFolder;
    if (!folder) return this.status();
    const date = this.now();
    const directory = path.join(folder, 'backups');
    try {
      fs.mkdirSync(directory, { recursive: true });
      const datePart = localDate(date);
      const destination = path.join(directory, `todos-daily-${datePart}.db`);
      let created = false;
      if (!fs.existsSync(destination)) {
        await this.database.serialized((db) => {
          const quoted = destination.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${quoted}'`);
        });
        created = true;
      }
      this.cleanup(directory, date);
      this.state = {
        lastBackupAt: created
          ? date.toISOString()
          : fs.statSync(destination).mtime.toISOString(),
        lastBackupPath: destination,
        lastError: null,
      };
    } catch (error) {
      this.state.lastError =
        error instanceof Error ? error.message : String(error);
    }
    return this.status();
  }

  async restoreFromBackup(): Promise<BackupStatus> {
    const folder = this.settings.backupFolder;
    if (!folder) throw new Error('Choose a backup folder first');
    const directory = path.join(folder, 'backups');
    fs.mkdirSync(directory, { recursive: true });

    // Loaded only for this UI action so headless backup tests do not require Electron.
    const { dialog } = await import('electron');
    const selection = await dialog.showOpenDialog({
      title: 'Restore from backup',
      defaultPath: directory,
      buttonLabel: 'Choose backup',
      filters: [{ name: 'LastTodo backups', extensions: ['db'] }],
      properties: ['openFile'],
    });
    const snapshot = selection.filePaths[0];
    if (selection.canceled || !snapshot) return this.status();

    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Restore from backup?',
      message: `Restore ${path.basename(snapshot)}?`,
      detail:
        'Your current local database will be replaced. Changes made since this backup was created will be lost.',
      buttons: ['Cancel', 'Restore backup'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return this.status();
    return this.restoreFrom(snapshot);
  }

  async restoreFrom(snapshot: string): Promise<BackupStatus> {
    if (path.extname(snapshot).toLowerCase() !== '.db')
      throw new Error('Choose a LastTodo database backup');
    if (!fs.statSync(snapshot).isFile())
      throw new Error('The selected backup is not a file');
    await this.database.replaceWith(snapshot);
    this.state = {
      lastBackupAt: new Date().toISOString(),
      lastBackupPath: snapshot,
      lastError: null,
    };
    return this.status();
  }

  start(): void {
    if (this.timer) return;
    void this.runNow();
    this.timer = setInterval(() => void this.runNow(), HOUR);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  cleanup(directory: string, now: Date): void {
    if (!fs.existsSync(directory)) return;
    const dailyCutoff = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    dailyCutoff.setDate(dailyCutoff.getDate() - 14);
    for (const fileName of fs.readdirSync(directory)) {
      const match = SNAPSHOT_PATTERN.exec(fileName);
      const timestamp = snapshotTime(fileName);
      if (!match || timestamp === null) continue;
      const expired =
        match[1] === 'hourly' || timestamp < dailyCutoff.getTime();
      if (expired) fs.unlinkSync(path.join(directory, fileName));
    }
  }
}
