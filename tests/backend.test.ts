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
    expect(
      initial.labels.find((label) => label.id === 'label-priority')
        ?.quickFilter,
    ).toBe(false);
    expect(
      initial.labels.find((label) => label.id === 'label-people')?.quickFilter,
    ).toBe(true);
    expect(
      initial.labels.find((label) => label.id === 'label-people')?.gatedTypeIds,
    ).toEqual(['type-people']);
  });

  it('enables the existing People label when quick filters are introduced', () => {
    const legacyPath = path.join(directory, 'legacy-v4.db');
    const legacy = new BetterSqlite3(legacyPath);
    legacy.exec(`
      CREATE TABLE types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO types (id, name) VALUES ('type-people', 'People');
      CREATE TABLE labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        gated_type_id TEXT,
        value_kind TEXT NOT NULL,
        cardinality TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO labels
        (id, name, scope, gated_type_id, value_kind, cardinality, sort_order)
      VALUES
        ('label-people', 'People', 'type', 'type-people', 'user_managed', 'multi', 0),
        ('label-project', 'Project', 'universal', NULL, 'enum', 'single', 1);
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type_id TEXT NOT NULL REFERENCES types(id),
        due_date TEXT,
        description TEXT,
        parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 4;
    `);
    legacy.close();

    const upgraded = new AppDatabase(legacyPath);
    expect(
      upgraded.db
        .prepare('SELECT id, quick_filter FROM labels ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'label-people', quick_filter: 1 },
      { id: 'label-project', quick_filter: 0 },
    ]);
    expect(
      upgraded.db.prepare('SELECT label_id, type_id FROM label_types').all(),
    ).toEqual([{ label_id: 'label-people', type_id: 'type-people' }]);
    expect(
      upgraded.db
        .prepare('PRAGMA table_info(labels)')
        .all()
        .map((column) => (column as { name: string }).name),
    ).not.toContain('value_kind');
    upgraded.close();
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
      CREATE TABLE labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        gated_type_id TEXT,
        value_kind TEXT NOT NULL,
        cardinality TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type_id TEXT NOT NULL REFERENCES types(id),
        due_date TEXT,
        description TEXT,
        parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      INSERT INTO todos
        (id, title, type_id, due_date, created_at, updated_at)
      VALUES
        ('legacy-todo', 'Existing task', 'type-team', '2026-08-20',
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
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
        .prepare('PRAGMA table_info(todos)')
        .all()
        .find((column) => (column as { name: string }).name === 'type_id'),
    ).toMatchObject({ notnull: 0 });
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

  it('preserves related task data while making types optional', () => {
    const legacyPath = path.join(directory, 'legacy-v6.db');
    const legacy = new BetterSqlite3(legacyPath);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`
      CREATE TABLE types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        emoji TEXT NOT NULL DEFAULT '🏷️'
      );
      CREATE TABLE labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        gated_type_id TEXT REFERENCES types(id),
        value_kind TEXT NOT NULL,
        cardinality TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        quick_filter INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE label_values (
        id TEXT PRIMARY KEY,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type_id TEXT NOT NULL REFERENCES types(id),
        due_date TEXT,
        description TEXT,
        parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE todo_labels (
        todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES labels(id),
        label_value_id TEXT NOT NULL REFERENCES label_values(id),
        PRIMARY KEY (todo_id, label_id, label_value_id)
      );
      CREATE TABLE todo_links (
        id TEXT PRIMARY KEY,
        todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        label TEXT,
        url TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE label_types (
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        type_id TEXT NOT NULL REFERENCES types(id),
        PRIMARY KEY (label_id, type_id)
      );
      CREATE INDEX idx_label_types_type ON label_types(type_id);
      CREATE INDEX idx_todos_active ON todos(due_date) WHERE completed_at IS NULL;
      CREATE INDEX idx_todos_parent ON todos(parent_id);

      INSERT INTO types (id,name,emoji) VALUES ('type-work','Work','💼');
      INSERT INTO labels
        (id,name,scope,gated_type_id,value_kind,cardinality,quick_filter)
      VALUES ('label-project','Project','type','type-work','enum','single',1);
      INSERT INTO label_types VALUES ('label-project','type-work');
      INSERT INTO label_values VALUES ('project-alpha','label-project','Alpha',0);
      INSERT INTO todos
        (id,title,type_id,due_date,created_at,updated_at,sensitive)
      VALUES
        ('parent','Parent','type-work','2026-08-20','2026-08-01','2026-08-01',0);
      INSERT INTO todos
        (id,title,type_id,parent_id,created_at,updated_at,sensitive)
      VALUES
        ('child','Child','type-work','parent','2026-08-01','2026-08-01',0);
      INSERT INTO todo_labels VALUES ('parent','label-project','project-alpha');
      INSERT INTO todo_links VALUES
        ('link-1','parent','Brief','https://example.test/brief',0);
      PRAGMA user_version = 6;
    `);
    legacy.close();

    const upgraded = new AppDatabase(legacyPath);
    expect(upgraded.db.pragma('foreign_key_check')).toEqual([]);
    expect(
      upgraded.db.prepare('SELECT id,parent_id FROM todos ORDER BY id').all(),
    ).toEqual([
      { id: 'child', parent_id: 'parent' },
      { id: 'parent', parent_id: null },
    ]);
    expect(upgraded.db.prepare('SELECT * FROM todo_labels').all()).toHaveLength(
      1,
    );
    expect(upgraded.db.prepare('SELECT * FROM todo_links').all()).toHaveLength(
      1,
    );
    expect(
      upgraded.db
        .prepare('PRAGMA table_info(todos)')
        .all()
        .find((column) => (column as { name: string }).name === 'type_id'),
    ).toMatchObject({ notnull: 0 });
    upgraded.close();
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

  it('creates and edits tasks without a type', async () => {
    const todo = await todos.create({
      title: 'Unsorted thought',
      dueDate: '2026-08-20',
      labels: [{ labelId: 'label-priority', valueIds: ['priority-low'] }],
    });
    expect(todo).toMatchObject({ typeId: null, typeName: null });
    await expect(
      todos.create({
        title: 'Invalid untyped label',
        dueDate: '2026-08-20',
        labels: [{ labelId: 'label-people', valueIds: [] }],
      }),
    ).rejects.toThrow('not available');

    expect(await todos.update(todo.id, { typeId: 'type-team' })).toMatchObject({
      typeId: 'type-team',
      typeName: 'Team',
    });
    expect(await todos.update(todo.id, { typeId: null })).toMatchObject({
      typeId: null,
      typeName: null,
    });
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

  it('supports taxonomy CRUD and detaches tasks when deleting a type', async () => {
    const type = await taxonomy.createType({
      name: 'Strategy',
      emoji: '🧭',
      sortOrder: 10,
    });
    expect(type.emoji).toBe('🧭');
    expect((await taxonomy.updateType(type.id, { emoji: '♟️' })).emoji).toBe(
      '♟️',
    );
    await expect(taxonomy.createType({ name: ' strategy ' })).rejects.toThrow(
      'unique',
    );
    await expect(
      taxonomy.updateType(type.id, { name: 'STRATEGY' }),
    ).resolves.toMatchObject({ name: 'STRATEGY' });
    const otherType = await taxonomy.createType({ name: 'Planning' });
    await expect(
      taxonomy.updateType(otherType.id, { name: ' strategy ' }),
    ).rejects.toThrow('unique');
    const label = await taxonomy.createLabel({
      name: 'Theme',
      scope: 'type',
      gatedTypeIds: [type.id, 'type-product'],
      cardinality: 'multi',
      quickFilter: true,
    });
    expect(label.quickFilter).toBe(true);
    expect(label.gatedTypeIds).toEqual(
      expect.arrayContaining([type.id, 'type-product']),
    );
    await expect(
      taxonomy.createLabel({
        name: ' theme ',
        scope: 'universal',
        gatedTypeIds: [],
        cardinality: 'single',
      }),
    ).rejects.toThrow('unique');
    await expect(
      taxonomy.updateLabel(label.id, { name: 'THEME' }),
    ).resolves.toMatchObject({ name: 'THEME' });
    expect(
      (await taxonomy.updateLabel(label.id, { quickFilter: false }))
        .quickFilter,
    ).toBe(false);
    const value = await taxonomy.createValue({
      labelId: label.id,
      value: 'Growth',
    });
    await expect(
      taxonomy.createValue({ labelId: label.id, value: ' growth ' }),
    ).rejects.toThrow('unique');
    const retention = await taxonomy.createValue({
      labelId: label.id,
      value: 'Retention',
    });
    await expect(
      taxonomy.updateValue(retention.id, { value: 'GROWTH' }),
    ).rejects.toThrow('unique');
    const otherLabel = await taxonomy.createLabel({
      name: 'Outcome',
      scope: 'universal',
      gatedTypeIds: [],
      cardinality: 'single',
    });
    await expect(
      taxonomy.updateLabel(otherLabel.id, { name: ' theme ' }),
    ).rejects.toThrow('unique');
    await expect(
      taxonomy.createValue({ labelId: otherLabel.id, value: 'GROWTH' }),
    ).resolves.toMatchObject({ value: 'GROWTH' });
    await todos.create({
      title: 'Explore market',
      typeId: type.id,
      dueDate: '2026-09-01',
      labels: [{ labelId: label.id, valueIds: [value.id] }],
    });
    await expect(
      todos.create({
        title: 'Product growth',
        typeId: 'type-product',
        dueDate: '2026-09-02',
        labels: [{ labelId: label.id, valueIds: [value.id] }],
      }),
    ).resolves.toMatchObject({ typeId: 'type-product' });
    await expect(
      taxonomy.updateLabel(label.id, { gatedTypeIds: [type.id] }),
    ).rejects.toThrow('another task type');
    await expect(
      todos.create({
        title: 'Operational growth',
        typeId: 'type-operational',
        dueDate: '2026-09-03',
        labels: [{ labelId: label.id, valueIds: [value.id] }],
      }),
    ).rejects.toThrow('not available');
    await expect(taxonomy.deleteValue(value.id)).rejects.toThrow('in use');
    const completed = await todos.create({
      title: 'Completed strategy',
      typeId: type.id,
      dueDate: '2026-08-15',
      labels: [{ labelId: label.id, valueIds: [value.id] }],
    });
    await todos.setCompleted(completed.id, true);

    await taxonomy.deleteType(type.id);
    expect(taxonomy.list().types.some((item) => item.id === type.id)).toBe(
      false,
    );
    expect(
      taxonomy.list().labels.find((item) => item.id === label.id),
    ).toMatchObject({ gatedTypeIds: ['type-product'] });
    expect(todos.get(completed.id)).toMatchObject({
      typeId: null,
      completedAt: expect.any(String),
      labels: [
        expect.objectContaining({
          labelId: label.id,
          values: [expect.objectContaining({ value: 'Growth' })],
        }),
      ],
    });
    await expect(
      todos.update(completed.id, {
        description: 'Historical context retained',
        labels: [{ labelId: label.id, valueIds: [value.id] }],
      }),
    ).resolves.toMatchObject({
      typeId: null,
      description: 'Historical context retained',
    });
    expect(
      todos
        .list({ includeCompleted: true })
        .find((todo) => todo.title === 'Explore market'),
    ).toMatchObject({ typeId: null });
    expect(todos.list({ includeCompleted: true, typeIds: [type.id] })).toEqual(
      [],
    );
  });

  it('allows every task type to be deleted', async () => {
    const task = await todos.create({
      title: 'Eventually untyped',
      typeId: 'type-team',
      dueDate: '2026-08-20',
    });
    for (const type of taxonomy.list().types)
      await taxonomy.deleteType(type.id);

    expect(taxonomy.list().types).toEqual([]);
    expect(todos.get(task.id).typeId).toBeNull();
    expect(
      taxonomy.list().labels.find((label) => label.id === 'label-people'),
    ).toMatchObject({
      scope: 'type',
      gatedTypeIds: [],
      quickFilter: true,
    });
    await expect(
      taxonomy.updateLabel('label-people', {
        scope: 'universal',
        gatedTypeIds: [],
      }),
    ).resolves.toMatchObject({
      scope: 'universal',
      gatedTypeIds: [],
      quickFilter: true,
    });
    await expect(
      taxonomy.updateLabel('label-people', { quickFilter: false }),
    ).resolves.toMatchObject({
      scope: 'universal',
      gatedTypeIds: [],
      quickFilter: false,
    });
    const replacement = await taxonomy.createType({
      name: 'Contacts',
      emoji: '📇',
    });
    await expect(
      taxonomy.updateLabel('label-people', {
        name: 'Contacts',
        scope: 'type',
        gatedTypeIds: [replacement.id],
      }),
    ).resolves.toMatchObject({
      name: 'Contacts',
      gatedTypeIds: [replacement.id],
    });
    await expect(
      todos.create({ title: 'No taxonomy needed', dueDate: '2026-08-21' }),
    ).resolves.toMatchObject({ typeId: null });
  });

  it('can remove and recreate the seeded People taxonomy as ordinary data', async () => {
    await taxonomy.deleteLabel('label-people');
    await taxonomy.deleteType('type-people');

    const type = await taxonomy.createType({ name: 'Contacts', emoji: '📇' });
    const label = await taxonomy.createLabel({
      name: 'Owner',
      scope: 'type',
      gatedTypeIds: [type.id],
      cardinality: 'multi',
      quickFilter: true,
    });

    expect(
      taxonomy.list().types.some((candidate) => candidate.id === type.id),
    ).toBe(true);
    expect(label).toMatchObject({
      name: 'Owner',
      gatedTypeIds: [type.id],
      quickFilter: true,
    });
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
    await service.restoreFrom(first.lastBackupPath!);
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

    await service.restoreFrom(first.lastBackupPath!);
    expect(todos.list().some((todo) => todo.title === 'In snapshot')).toBe(
      true,
    );
    expect(todos.list().some((todo) => todo.title === 'Next day')).toBe(false);
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
