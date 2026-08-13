import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 3;

const migrations: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('universal','type')),
        gated_type_id TEXT REFERENCES types(id),
        value_kind TEXT NOT NULL CHECK (value_kind IN ('enum','user_managed')),
        cardinality TEXT NOT NULL CHECK (cardinality IN ('single','multi')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        CHECK ((scope = 'universal' AND gated_type_id IS NULL) OR
               (scope = 'type' AND gated_type_id IS NOT NULL))
      );
      CREATE TABLE label_values (
        id TEXT PRIMARY KEY,
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(label_id, value)
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
      CREATE INDEX idx_todos_active ON todos(due_date) WHERE completed_at IS NULL;
      CREATE INDEX idx_todos_parent ON todos(parent_id);
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
    `);

    const insertType = db.prepare(
      'INSERT INTO types (id, name, sort_order) VALUES (?, ?, ?)',
    );
    ['Team', 'People', 'Product', 'Operational'].forEach((name, index) =>
      insertType.run(`type-${name.toLowerCase()}`, name, index),
    );
    db.prepare(
      `INSERT INTO labels
      (id, name, scope, gated_type_id, value_kind, cardinality, sort_order)
      VALUES ('label-priority', 'Priority', 'universal', NULL, 'enum', 'single', 0)`,
    ).run();
    const insertValue = db.prepare(
      'INSERT INTO label_values (id, label_id, value, sort_order) VALUES (?, ?, ?, ?)',
    );
    ['Low', 'Medium', 'High'].forEach((value, index) =>
      insertValue.run(
        `priority-${value.toLowerCase()}`,
        'label-priority',
        value,
        index,
      ),
    );
    db.prepare(
      `INSERT INTO labels
      (id, name, scope, gated_type_id, value_kind, cardinality, sort_order)
      VALUES ('label-people', 'People', 'type', 'type-people', 'user_managed', 'multi', 0)`,
    ).run();
  },
  // Deliberate no-op migration proving ordered, idempotent migration sequencing.
  2: () => undefined,
  3: (db) => {
    db.exec(
      'ALTER TABLE todos ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1))',
    );
  },
};

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${current} is newer than supported schema ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  for (
    let version = current + 1;
    version <= CURRENT_SCHEMA_VERSION;
    version += 1
  ) {
    const migration = migrations[version];
    if (!migration) throw new Error(`Missing database migration ${version}`);
    db.transaction(() => {
      migration(db);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
