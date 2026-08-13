import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AppDatabase,
  migrationRecoveryPath,
} from '../src/main/database/database';
import { CURRENT_SCHEMA_VERSION } from '../src/main/database/migrations';
import { BackupService } from '../src/main/services/backupService';
import { SettingsStore } from '../src/main/services/settingsStore';
import { TaxonomyService } from '../src/main/services/taxonomyService';
import { TodoService } from '../src/main/services/todoService';

describe('backend services', () => {
  let directory: string;
  let database: AppDatabase;
  let todos: TodoService;
  let taxonomy: TaxonomyService;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lasttodo-test-'));
    database = new AppDatabase(path.join(directory, 'todos.db'));
    todos = new TodoService(database);
    taxonomy = new TaxonomyService(database);
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('migrates idempotently and seeds the default taxonomy', () => {
    expect(database.db.pragma('user_version', { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    const initial = taxonomy.list();
    expect(initial.types.map((type) => type.name)).toEqual([
      'Team',
      'People',
      'Product',
      'Operational',
    ]);
    expect(initial.types.map((type) => type.emoji)).toEqual([
      '🤝',
      '👥',
      '🧩',
      '⚙️',
    ]);
    expect(
      initial.labels.find((label) => label.name === 'Priority')?.values,
    ).toHaveLength(3);
  });

  it('upgrades existing databases with non-sensitive todos by default', () => {
    const legacyPath = path.join(directory, 'legacy-v2.db');
    const legacy = new BetterSqlite3(legacyPath);
    legacy.exec(`
      CREATE TABLE types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO types (id, name, sort_order)
      VALUES ('type-team', 'Team', 0);
      CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      INSERT INTO todos (id, title) VALUES ('legacy-todo', 'Existing task');
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const upgraded = new AppDatabase(legacyPath);
    const row = upgraded.db
      .prepare('SELECT sensitive FROM todos WHERE id = ?')
      .get('legacy-todo') as { sensitive: number };
    expect(row.sensitive).toBe(0);
    expect(
      upgraded.db
        .prepare('SELECT emoji FROM types WHERE id = ?')
        .get('type-team'),
    ).toEqual({ emoji: '🤝' });
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    upgraded.close();

    const recoveryPath = migrationRecoveryPath(legacyPath, 2);
    expect(fs.existsSync(recoveryPath)).toBe(true);
    const recovery = new BetterSqlite3(recoveryPath, { readonly: true });
    expect(recovery.pragma('user_version', { simple: true })).toBe(2);
    expect(
      recovery
        .prepare('PRAGMA table_info(todos)')
        .all()
        .some((column) => (column as { name: string }).name === 'sensitive'),
    ).toBe(false);
    expect(
      recovery
        .prepare('SELECT title FROM todos WHERE id = ?')
        .get('legacy-todo'),
    ).toEqual({ title: 'Existing task' });
    recovery.close();
  });

  it('persists todos, inherited dates, labels, links and compound queries', async () => {
    const parent = await todos.create({
      title: 'Plan launch',
      typeId: 'type-team',
      dueDate: '2026-08-20',
      labels: [{ labelId: 'label-priority', valueIds: ['priority-high'] }],
      links: [{ label: 'Brief', url: 'https://example.test/brief' }],
    });
    const child = await todos.create({
      title: 'Write launch notes',
      typeId: 'type-team',
      parentId: parent.id,
    });
    expect(child.effectiveDueDate).toBe('2026-08-20');
    expect(todos.get(parent.id).childProgress).toEqual({
      completed: 0,
      total: 1,
    });
    expect(
      todos.list({
        search: 'launch',
        typeIds: ['type-team'],
        labelValueIds: ['priority-high'],
      }),
    ).toHaveLength(1);
    expect(parent.links[0]?.url).toBe('https://example.test/brief');
  });

  it('persists sensitivity when creating and editing todos', async () => {
    const todo = await todos.create({
      title: 'Private planning',
      typeId: 'type-team',
      dueDate: '2026-08-20',
      sensitive: true,
    });
    expect(todo.sensitive).toBe(true);
    expect(todos.get(todo.id).sensitive).toBe(true);

    const updated = await todos.update(todo.id, { sensitive: false });
    expect(updated.sensitive).toBe(false);
    expect(todos.get(todo.id).sensitive).toBe(false);
  });

  it('enforces hierarchy, completion, label scope and cardinality', async () => {
    const parent = await todos.create({
      title: 'Parent',
      typeId: 'type-team',
      dueDate: '2026-08-20',
    });
    const child = await todos.create({
      title: 'Child',
      typeId: 'type-team',
      parentId: parent.id,
    });
    await expect(
      todos.create({
        title: 'Grandchild',
        typeId: 'type-team',
        parentId: child.id,
      }),
    ).rejects.toThrow('Children cannot have children');
    await expect(todos.setCompleted(parent.id, true)).rejects.toThrow(
      'every child',
    );
    await todos.setCompleted(child.id, true);
    expect(
      (await todos.setCompleted(parent.id, true)).completedAt,
    ).not.toBeNull();
    await todos.setCompleted(child.id, false);
    expect(todos.get(parent.id).completedAt).toBeNull();
    await todos.setCompleted(child.id, true);
    await todos.setCompleted(parent.id, true);
    await todos.create({
      title: 'New child reopens parent',
      typeId: 'type-team',
      parentId: parent.id,
    });
    expect(todos.get(parent.id).completedAt).toBeNull();
    await expect(
      todos.create({
        title: 'Wrong scope',
        typeId: 'type-team',
        dueDate: '2026-08-20',
        labels: [{ labelId: 'label-people', valueIds: [] }],
      }),
    ).rejects.toThrow('not available');
    await expect(
      todos.create({
        title: 'Two priorities',
        typeId: 'type-team',
        dueDate: '2026-08-20',
        labels: [
          {
            labelId: 'label-priority',
            valueIds: ['priority-low', 'priority-high'],
          },
        ],
      }),
    ).rejects.toThrow('only one');
  });

  it('serializes concurrent transactional writes and cascades hard deletes', async () => {
    const parent = await todos.create({
      title: 'Parent',
      typeId: 'type-team',
      dueDate: '2026-08-20',
    });
    const children = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        todos.create({
          title: `Child ${index}`,
          typeId: 'type-team',
          parentId: parent.id,
        }),
      ),
    );
    expect(todos.get(parent.id).childProgress.total).toBe(8);
    await todos.delete(parent.id);
    expect(
      todos
        .list({ includeCompleted: true })
        .filter((todo) => children.some((child) => child.id === todo.id)),
    ).toHaveLength(0);
  });

  it('supports taxonomy CRUD and prevents deletion while in use', async () => {
    const type = await taxonomy.createType({
      name: 'Strategy',
      emoji: '🧭',
      sortOrder: 10,
    });
    expect(type.emoji).toBe('🧭');
    expect((await taxonomy.updateType(type.id, { emoji: '♟️' })).emoji).toBe(
      '♟️',
    );
    const label = await taxonomy.createLabel({
      name: 'Theme',
      scope: 'type',
      gatedTypeId: type.id,
      valueKind: 'user_managed',
      cardinality: 'multi',
    });
    const value = await taxonomy.createValue({
      labelId: label.id,
      value: 'Growth',
    });
    await todos.create({
      title: 'Explore market',
      typeId: type.id,
      dueDate: '2026-09-01',
      labels: [{ labelId: label.id, valueIds: [value.id] }],
    });
    await expect(taxonomy.deleteValue(value.id)).rejects.toThrow('in use');
    await expect(taxonomy.deleteType(type.id)).rejects.toThrow('in use');
  });
});

describe('settings', () => {
  it('persists completion of first-time onboarding', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'lasttodo-settings-test-'),
    );
    const settingsPath = path.join(directory, 'settings.json');
    const settings = new SettingsStore(settingsPath);
    expect(settings.onboardingComplete).toBe(false);

    settings.completeOnboarding();

    expect(new SettingsStore(settingsPath).onboardingComplete).toBe(true);
    settings.setOnboardingComplete(false);
    expect(new SettingsStore(settingsPath).onboardingComplete).toBe(false);
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('backups', () => {
  let directory: string;
  let database: AppDatabase;
  let settings: SettingsStore;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lasttodo-backup-test-'));
    database = new AppDatabase(path.join(directory, 'working', 'todos.db'));
    settings = new SettingsStore(
      path.join(directory, 'working', 'settings.json'),
    );
    settings.setBackupFolder(path.join(directory, 'synced'));
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps backups disabled until a folder is selected', async () => {
    settings.setBackupFolder(null);
    const service = new BackupService(database, settings);

    expect(service.status()).toMatchObject({
      folder: null,
      backupDirectory: null,
      lastBackupAt: null,
      lastBackupPath: null,
    });
    await service.runNow();
    expect(fs.existsSync(path.join(directory, 'synced', 'backups'))).toBe(
      false,
    );
  });

  it('creates at most one snapshot per day and creates again the next day', async () => {
    let now = new Date(2026, 7, 12, 9, 0, 0);
    const service = new BackupService(database, settings, () => now);
    const todos = new TodoService(database);
    await todos.create({
      title: 'In snapshot',
      typeId: 'type-team',
      dueDate: '2026-08-12',
    });
    const first = await service.runNow();
    expect(path.basename(first.lastBackupPath!)).toBe(
      'todos-daily-2026-08-12.db',
    );
    const firstContents = fs.readFileSync(first.lastBackupPath!);

    await todos.create({
      title: 'After snapshot',
      typeId: 'type-team',
      dueDate: '2026-08-13',
    });
    now = new Date(2026, 7, 12, 10, 0, 0);
    const second = await service.runNow();
    expect(second.lastBackupPath).toBe(first.lastBackupPath);
    expect(fs.readdirSync(path.dirname(first.lastBackupPath!))).toEqual([
      'todos-daily-2026-08-12.db',
    ]);
    expect(fs.readFileSync(first.lastBackupPath!)).toEqual(firstContents);
    expect(BackupService.findNewest(settings.backupFolder)).toBe(
      first.lastBackupPath,
    );

    await todos.delete(
      todos.list().find((todo) => todo.title === 'After snapshot')!.id,
    );
    await service.restoreLatest();
    expect(todos.list().some((todo) => todo.title === 'In snapshot')).toBe(
      true,
    );
    expect(todos.list().some((todo) => todo.title === 'After snapshot')).toBe(
      false,
    );

    await todos.create({
      title: 'Next day',
      typeId: 'type-team',
      dueDate: '2026-08-14',
    });
    now = new Date(2026, 7, 13, 8, 0, 0);
    const nextDay = await service.runNow();
    expect(path.basename(nextDay.lastBackupPath!)).toBe(
      'todos-daily-2026-08-13.db',
    );
    expect(
      fs.readdirSync(path.dirname(nextDay.lastBackupPath!)).sort(),
    ).toEqual(['todos-daily-2026-08-12.db', 'todos-daily-2026-08-13.db']);
  });

  it('removes hourly snapshots and daily snapshots older than 15 calendar days', () => {
    const backupDirectory = path.join(settings.backupFolder!, 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const files = [
      'todos-daily-2026-07-28.db',
      'todos-daily-2026-07-29.db',
      'todos-daily-2026-08-12.db',
      'todos-hourly-2026-08-12T11-59-59.db',
      'ignore-me.txt',
    ];
    for (const file of files)
      fs.writeFileSync(path.join(backupDirectory, file), 'x');
    new BackupService(database, settings).cleanup(
      backupDirectory,
      new Date(2026, 7, 12, 12, 0, 0),
    );
    expect(fs.readdirSync(backupDirectory).sort()).toEqual([
      'ignore-me.txt',
      'todos-daily-2026-07-29.db',
      'todos-daily-2026-08-12.db',
    ]);
  });

  it('bootstraps a missing working database from the newest synced snapshot', async () => {
    const service = new BackupService(
      database,
      settings,
      () => new Date(2026, 7, 12, 8, 0, 0),
    );
    await service.runNow();
    const destination = path.join(directory, 'fresh', 'todos.db');
    const restored = BackupService.restoreOnFreshInstall(
      destination,
      settings.backupFolder,
    );
    expect(restored).toContain('todos-daily-2026-08-12.db');
    const fresh = new AppDatabase(destination);
    expect(fresh.db.pragma('user_version', { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    fresh.close();
  });
});
