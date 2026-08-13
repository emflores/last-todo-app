import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 7;

const DEFAULT_TYPE_EMOJI: Record<string, string> = {
  'type-team': '🤝',
  'type-people': '👥',
  'type-product': '🧩',
  'type-operational': '⚙️',
};

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
  4: (db) => {
    db.exec("ALTER TABLE types ADD COLUMN emoji TEXT NOT NULL DEFAULT '🏷️'");
    const updateEmoji = db.prepare('UPDATE types SET emoji = ? WHERE id = ?');
    for (const [id, emoji] of Object.entries(DEFAULT_TYPE_EMOJI))
      updateEmoji.run(emoji, id);
  },
  5: (db) => {
    db.exec(
      'ALTER TABLE labels ADD COLUMN quick_filter INTEGER NOT NULL DEFAULT 0 CHECK (quick_filter IN (0, 1))',
    );
    db.prepare('UPDATE labels SET quick_filter=1 WHERE id=?').run(
      'label-people',
    );
  },
  6: (db) => {
    db.exec(`
      CREATE TABLE label_types (
        label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        type_id TEXT NOT NULL REFERENCES types(id),
        PRIMARY KEY (label_id, type_id)
      );
      INSERT INTO label_types (label_id, type_id)
      SELECT id, gated_type_id FROM labels
      WHERE scope='type' AND gated_type_id IS NOT NULL;
      CREATE INDEX idx_label_types_type ON label_types(type_id);
      UPDATE labels SET value_kind='enum';
    `);
  },
  7: (db) => {
    db.exec(`
      CREATE TABLE labels_v7 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('universal','type')),
        cardinality TEXT NOT NULL CHECK (cardinality IN ('single','multi')),
        quick_filter INTEGER NOT NULL DEFAULT 0 CHECK (quick_filter IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO labels_v7
        (id,name,scope,cardinality,quick_filter,sort_order)
      SELECT id,name,scope,cardinality,quick_filter,sort_order FROM labels;
      DROP TABLE labels;
      ALTER TABLE labels_v7 RENAME TO labels;

      CREATE TABLE todos_v7 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type_id TEXT REFERENCES types(id) ON DELETE SET NULL,
        due_date TEXT,
        description TEXT,
        parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1))
      );
      INSERT INTO todos_v7
        (id,title,type_id,due_date,description,parent_id,created_at,updated_at,completed_at,sensitive)
      SELECT id,title,type_id,due_date,description,parent_id,created_at,updated_at,completed_at,sensitive
      FROM todos;
      DROP TABLE todos;
      ALTER TABLE todos_v7 RENAME TO todos;
      CREATE INDEX idx_todos_active ON todos(due_date) WHERE completed_at IS NULL;
      CREATE INDEX idx_todos_parent ON todos(parent_id);
    `);
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
    const run = () =>
      db.transaction(() => {
        migration(db);
        db.pragma(`user_version = ${version}`);
      })();
    if (version !== 7) {
      run();
      continue;
    }

    // SQLite cannot relax NOT NULL or remove legacy columns in place. Disable
    // foreign-key actions outside the transaction while the referenced labels
    // and todos tables are rebuilt, then validate every retained relationship.
    db.pragma('foreign_keys = OFF');
    try {
      run();
    } finally {
      db.pragma('foreign_keys = ON');
    }
    const violations = db.pragma('foreign_key_check') as unknown[];
    if (violations.length)
      throw new Error('Database migration left invalid relationships');
  }
}
