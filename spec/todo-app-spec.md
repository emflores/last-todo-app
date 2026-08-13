# LastTodo — Electron App Spec (v0.3)

## 1. Premise
A single-user desktop to-do app tailored to your workflow. Local-first. A local SQLite database is the working store; periodic snapshots are written to a folder you choose, so a Box/Drive-synced folder gives you cloud backup and cross-machine restore for free. Source lives on public GitHub; builds are reproducible on any OS.

## 2. Non-goals (v1)
- No server, accounts, or auth.
- No real-time multi-device collaboration (single active device at a time — see §4.4).
- No mobile client.
- No recurring to-dos.
- **No prebuilt binary distribution and no CI** — cloners build locally (§11).

## 3. Storage, persistence & migrations

### 3.1 Working store
- **SQLite**, running locally in Electron's `userData` directory — **not** in the synced folder. (A live SQLite DB inside a cloud-synced folder is a corruption vector; snapshots sidestep that entirely.)
- Chosen over a JSON blob for schema rigidity and safe, versioned migrations.

### 3.2 Writes
- All writes go through the Electron main process, serialized via a single connection / write queue (mutex), each mutation in a transaction.
- Persisted **per-edit** — no debounce. SQLite writes are cheap and transactional, so immediate writes are both fine and more crash-safe.

### 3.3 Migrations
- Track schema version with `PRAGMA user_version` (or a `_migrations` table).
- On startup, run any pending migrations in order inside a transaction before the app reads/writes.
- This is the payoff for choosing SQLite: field changes and breaking changes go through explicit, tested migration steps.

### 3.4 Bootstrap on a fresh machine
- On first run (no local DB), if the synced folder contains snapshots, restore from the newest one; otherwise create an empty DB and run migrations to current.

## 4. Backups

### 4.1 What & when
- On **app startup** and **hourly** while running, dump a snapshot into `<syncedFolder>/backups/`.
- Format: a compacted `.db` file via `VACUUM INTO` — a transactionally consistent copy of the live DB. Restore is a drop-in, and it includes completed rows, so there's no separate completed-store backup to manage.

### 4.2 Daily vs hourly
- The **first** snapshot of each calendar day is the **daily** backup — whether that's the startup snapshot, or the first hourly tick after the day boundary if the app was already running.
- All other snapshots that day are **hourly**.
- Filenames encode the tier and timestamp, e.g. `todos-daily-2026-08-11.db`, `todos-hourly-2026-08-11T14-00-00.db`. "First of the day" is detected by whether today's `daily` file already exists (robust across restarts).

### 4.3 Retention & cleanup
- **Daily:** keep 30 days (≈30 files).
- **Hourly:** keep 24 hours (≈24 files).
- Cleanup deletes `daily` older than 30 days and `hourly` older than 24 hours.
- Cleanup runs **on startup and hourly** (same cadence as the backup job) so hourly files stay bounded even across multi-day sessions.

### 4.4 Multi-device caveat
Snapshots are last-write-wins in the synced folder, so the model assumes one active device at a time; a second device restores from the latest snapshot when it takes over. True concurrent multi-device editing would need an op-log/CRDT layer — out of scope for v1.

## 5. Data model (schema sketch)

```sql
-- Config
CREATE TABLE types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE labels (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('universal','type')),
  gated_type_id TEXT REFERENCES types(id),          -- set when scope='type'
  value_kind    TEXT NOT NULL CHECK (value_kind IN ('enum','user_managed')),
  cardinality   TEXT NOT NULL CHECK (cardinality IN ('single','multi')),
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE label_values (
  id         TEXT PRIMARY KEY,
  label_id   TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Todos (active + completed live together)
CREATE TABLE todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  type_id      TEXT NOT NULL REFERENCES types(id),
  due_date     TEXT,               -- ISO date; nullable only for children that inherit parent's
  description  TEXT,
  parent_id    TEXT REFERENCES todos(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT                -- NULL = active, timestamp = completed
);

-- Partial index: only active rows, so default queries stay fast no matter how big the archive grows
CREATE INDEX idx_todos_active ON todos(due_date) WHERE completed_at IS NULL;
CREATE INDEX idx_todos_parent ON todos(parent_id);

CREATE TABLE todo_labels (
  todo_id        TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  label_id       TEXT NOT NULL REFERENCES labels(id),
  label_value_id TEXT NOT NULL REFERENCES label_values(id),
  PRIMARY KEY (todo_id, label_id, label_value_id)
);

CREATE TABLE todo_links (
  id         TEXT PRIMARY KEY,
  todo_id    TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  label      TEXT,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

Notes:
- **Required fields:** `title`, `type_id`, `due_date` (except children inheriting a parent's date). Enforced in app logic.
- **Cardinality** (single vs multi) enforced in app logic on write to `todo_labels`.
- **Config lives in the DB** (`types`, `labels`, `label_values`), so it travels in every snapshot.

## 6. Behavior rules

### 6.1 Types & labels
- Every to-do has exactly one required **type**.
- Selecting a type reveals that type's **type-gated** labels; **universal** labels (e.g. Priority = Low/Med/High, single) always show.
- People is a type-gated, user-managed, multi-value label; Priority is universal, enum, single. New universal labels drop in with `scope='universal'` and no new machinery.

### 6.2 Hierarchy & completion
- One level of nesting (a parent and its children; children can't have children).
- Create a child two ways: set a parent via autocomplete when creating a task, or quick-add a child from an open task.
- Child `due_date` optional; if unset, it inherits the parent's.
- **Complete is soft** (`completed_at` set); a parent can be completed only when every child is completed or deleted.
- **Delete is hard**; deleting a parent cascades to its children (`ON DELETE CASCADE`) — with a confirm.
- Un-complete = clear `completed_at`.

## 7. Views, filters & search

### 7.1 Default board — swim lanes by due date
Columns, left to right, with `d = due date`, `t = today`:
- **Overdue** — `d < t`
- **Today** — `d = t`
- **Next 7 Days** — `t < d <= t+7`
- **Next 30 Days** — `t+7 < d <= t+30`
- **Future** — `d > t+30`

Rolling windows (not calendar week/month). Completed items are hidden by default; a **Show completed** toggle queries `completed_at IS NOT NULL` on demand. Cards show title, label chips, due date, and child progress (e.g. 3/5).

### 7.2 Left rail — quick filters
- Filter by **type** (Team, People, Product, Operational, …).
- **People** view pins a person picker at top to drill into one person.
- Compound filters supported, e.g. "Team-level, grouped by Priority."

### 7.3 Search
- A top search bar that **compounds with active filters**: it searches within the current filtered set (e.g. with a People-tag filter applied, search is scoped to that tag).

## 8. Create / edit UX
- Fields: Title (required), Due date (required), Type (required); type-gated + universal labels; Description (free text); Links (add-more `{label?, url}`); optional parent.
- A settings area manages Types, Labels, and label values (add a person, add a product, etc.).

## 9. Suggested stack
- **Electron**: main process owns the DB, writes, migrations, snapshots, cleanup, folder dialog; renderer is UI over IPC.
- SQLite driver: `better-sqlite3` (synchronous, fast, has an online-backup API; `VACUUM INTO` for snapshots).
- Settings (chosen folder path, etc.): `electron-store`.
- UI: React (your call).

## 10. Remaining defaults — flag any to change
1. **In-lane sort:** due date ascending, then priority desc, then created_at.
2. **Day boundary / due dates** interpreted in the user's local timezone.

## 11. Build, packaging & CI

### 11.1 Packaging & build model
- **Distribution model:** whoever clones the repo builds it locally on their own machine with their own dependencies, producing an executable for *their* OS. No binaries are ever shipped.
- **electron-builder** handles packaging. A single `npm ci && npm run build` yields an installer/executable for whatever OS the build runs on (macOS dmg/zip, Linux AppImage/deb, Windows nsis).
- The native-module rebuild (§11.2) runs as part of that local build, so a clean clone → install → build is all a cloner needs.

### 11.2 Native-module reality (better-sqlite3)
- `better-sqlite3` is a native addon and must be rebuilt against Electron's ABI. electron-builder does this during packaging (or `@electron/rebuild`).
- Consequence: you **can't cross-compile all platforms from one machine** — each OS's binary is built on that OS. Hence the CI matrix below.

### 11.3 Public-repo hygiene
- Commit the lockfile; pin Node (`.nvmrc` / `engines`) and Electron/electron-builder versions so a clone builds reproducibly.
- README with per-OS build steps; a LICENSE; `.gitignore` (node_modules, dist, local DB).
- **No code signing / notarization** (not shipping) — locally built binaries are unsigned, which is fine for personal use; note it in the README so Gatekeeper/SmartScreen warnings aren't a surprise.
