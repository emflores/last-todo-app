# LastTodo — Implementation Plan

Build order is bottom-up: the data layer is fully working and testable through IPC before any UI exists, so the hardest correctness work (schema, migrations, completion rules, backups) is done and verified against a stable foundation rather than through the UI.

Distribution is clone-and-build-locally — no shipping — so tooling is set up once in Phase 0 and mostly ignored after.

---

## Phase 0 — Scaffold & tooling
Goal: an empty Electron window launches, and `npm ci && npm run build` produces a local executable.

- Electron + React + TypeScript project structure: `main/`, `preload/`, `renderer/`.
- `preload` with `contextBridge` exposing a typed IPC surface (no `nodeIntegration` in the renderer).
- electron-builder config; `better-sqlite3` installed and rebuilt against Electron's ABI (`@electron/rebuild` wired into the build).
- Repo hygiene: committed lockfile, `.nvmrc` / `engines`, ESLint/Prettier, `.gitignore` (node_modules, dist, local DB), LICENSE, README skeleton with per-OS build steps.

**Done when:** clean clone → install → build works on your OS and launches a blank window.

---

## Phase 1 — Schema & migrations
Goal: on startup the DB is created (or opened) in `userData` and migrated to current.

- Migration runner keyed on `PRAGMA user_version`, each step in a transaction.
- Migration `0001`: the full schema from spec §5 (types, labels, label_values, todos, todo_labels, todo_links, indexes incl. the active partial index).
- Optional seed migration: default types + the universal Priority label (Low/Med/High).

**Done when:** launching creates/migrates the DB; re-launch is idempotent; a deliberate `0002` no-op proves the runner sequences correctly.

---

## Phase 2 — Data layer: CRUD & domain rules
Goal: the full to-do lifecycle works through IPC, before any UI, covered by unit tests on the service layer.

- Todo CRUD; children (one level); labels honoring **scope** (type-gated vs universal) and **cardinality** (single vs multi); links.
- Completion rules: soft complete/un-complete via `completed_at`; a parent completes only when all children are completed or deleted.
- Hard delete with `ON DELETE CASCADE` for children/labels/links.
- All writes serialized in the main process, each in a transaction; expose as typed IPC handlers.

**Done when:** service-layer unit tests cover create/edit/complete/uncomplete/delete, the parent-gating rule, and cardinality/scope enforcement — all green without a UI.

---

## Phase 3 — Snapshots, backups & cleanup
Goal: backups appear on cadence, retention holds, and restore works.

- Folder picker + persisted path (`electron-store`).
- `VACUUM INTO` snapshot into `<folder>/backups/`; daily-vs-hourly naming and "first of the day = daily" detection (existence of today's daily file).
- Scheduler: snapshot on startup + hourly; cleanup on startup + hourly (daily >30d, hourly >24h).
- Bootstrap: on a fresh machine with no local DB, restore from the newest snapshot in the folder.

**Done when:** snapshots land on schedule with correct tiers, retention prunes correctly across a simulated multi-day run, and a wiped `userData` restores from the folder.

---

## Phase 4 — Renderer: board & core editing
Goal: full visual CRUD against the Phase 2/3 data layer.

- Swim-lane board by the §7.1 due-date buckets (Overdue · Today · Next 7 · Next 30 · Future); cards with label chips, due date, child progress.
- Create/edit form: title, due date, type selector; type-gated labels appear on type select, universal labels always shown; description; links add-more; parent autocomplete; quick-add-child from an open task.
- Show-completed toggle.

**Done when:** every data-layer operation is reachable from the UI and the board reflects it live.

---

## Phase 5 — Renderer: filters, search, settings
Goal: navigation, filtering, and taxonomy management.

- Left-rail type filters; people drill-down; compound filters (e.g. team grouped by priority); in-lane sort (due asc → priority desc → created_at).
- Top search bar compounding with active filters (scoped within an applied people tag).
- Settings UI to add/rename types, labels, and label values.

**Done when:** all filters/search/settings work and compose correctly.

---

## Phase 6 — Hardening & polish
Goal: v1.

- Error handling: write failures, missing/corrupt DB, unavailable sync folder; confirms (parent delete).
- Empty states, keyboard shortcuts, basic accessibility.
- Finalize README build docs (per-OS clone → install → build).

**Done when:** the happy path and the obvious failure paths are both handled, and a fresh cloner can build and run from the README alone.

---

### Sequencing notes
- Phases 1→3 are backend-only and independently testable; you could stop after 3 and have a headless, correct, backed-up data engine.
- Phases 4→5 depend only on the IPC surface from Phase 2, so UI work can't outrun a broken data layer.
- Phase 0's native-module setup is the one thing that, if skipped, blocks everything — do it first and confirm a real build before writing features.
