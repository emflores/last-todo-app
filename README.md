# LastTodo

LastTodo is a local-first desktop todo board built with Electron, React,
TypeScript, and SQLite. The Electron main process owns all persistence, while a
small typed preload bridge exposes only the app's IPC API to the renderer.

The working database stays in Electron's local `userData` directory. Optional
SQLite snapshots can be written to a folder managed by Box, Drive, or another
sync provider. Use the app on one device at a time: snapshots are intended for
backup and handoff, not concurrent editing.

## Prerequisites

- Git
- Node.js 22 (the exact development version is in `.nvmrc`)
- npm 10 or newer

`better-sqlite3` is a native module. Most installs use a downloaded prebuild,
but a local compiler toolchain may be required:

- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Visual Studio Build Tools with **Desktop development with C++**
- Debian/Ubuntu: `build-essential` and `python3`; `fakeroot` and `dpkg` are also
  useful when producing a `.deb`

## Install and run

```bash
nvm use
npm ci
npm run dev
```

The development command runs `@electron/rebuild` so the SQLite addon targets
Electron's ABI, then starts Vite and opens the Electron window with hot reload.
Packaging also rebuilds native dependencies through electron-builder.

### Linux sandbox setup

On Linux distributions that restrict unprivileged user namespaces (including
some Ubuntu configurations), Electron may report that `chrome-sandbox` is not
configured correctly. Fix the helper's ownership and permissions from the
project root:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Then run `npm run dev` again. Verify the permissions with:

```bash
stat -c '%U:%G %a' node_modules/electron/dist/chrome-sandbox
```

The expected output is `root:root 4755`. Because `npm ci` recreates
`node_modules`, you may need to repeat this setup afterward.

For a temporary development-only workaround, run
`npm run dev -- --noSandbox`. This disables Chromium's process sandbox, so the
SUID helper setup above is preferred.

For a production-mode smoke test without creating an installer:

```bash
npm run build:app
npm start
```

## Build a local executable

Run the build on the operating system you intend to use:

```bash
npm ci
npm run build
```

Artifacts are written to `release/`. electron-builder produces DMG/ZIP on
macOS, AppImage/DEB on Linux, and NSIS on Windows. Native dependencies mean this
project is not set up to cross-compile every platform from one machine.

To inspect an unpacked application during development, run
`npm run build:dir`.

### Unsigned build caveat

These are personal, local builds and are not code-signed or notarized. macOS
Gatekeeper and Windows SmartScreen may warn when the app is opened for the
first time. Review the source and build it yourself, then use the operating
system's normal one-time **Open** / **Run anyway** flow if you trust your build.

## Application updates

Packaged builds check GitHub Releases for the latest published version. When a
newer release includes a macOS DMG, LastTodo shows a download link and opens
the GitHub asset in the default browser. The user downloads and installs the
new version manually; LastTodo never downloads or installs an update in the
background.

The SQLite database remains under Electron's per-user `userData` directory and
is never part of the installed application bundle, so replacing the app does
not replace its data.

Before a schema migration, LastTodo writes a consistent database snapshot to
`migration-recovery/` beside the live database. Existing recovery files are
kept so a failed application upgrade cannot replace its own rollback point.

Release tags must match the version in `package.json`—for example, version
`0.2.0` must be released as `v0.2.0`. The GitHub Actions workflow enforces this
and uploads each platform's installers. Signing is optional for this manual
download flow, although unsigned macOS and Windows builds still show the
operating system warnings described above.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run format:check
```

After running the Electron app, `better-sqlite3` targets Electron rather than
the system Node ABI. If a direct Node test run reports a native binding error,
run `npm run rebuild:node` before `npm test`; `npm run dev` will switch it back
for Electron automatically.

`npm run typecheck` checks the Electron main/preload code and browser renderer
with their respective TypeScript environments.

## Diagnostic logs

LastTodo writes structured lifecycle and error events to `main.log` in
Electron's application logs directory. Chromium and native-process diagnostics
are written beside it in `chromium.log`. `main.log` rotates at roughly 2 MB;
an oversized Chromium log is rotated on the next launch. Each keeps one
`.previous.log` file.

The exact directory is printed when the app starts. Typical locations are
`~/Library/Logs/LastTodo` on macOS and the `logs/` folder inside LastTodo's
per-user application data directory on Linux and Windows. Renderer exits,
unresponsive windows, failed page loads, uncaught renderer errors, Electron
child-process exits, and uncaught main-process errors are recorded without task
or database contents.

## Project layout

```text
src/main/       Electron lifecycle, SQLite, domain services, and IPC handlers
src/preload/    Typed, context-isolated `window.todoAPI` bridge
src/renderer/   React application and styles
src/shared/     IPC contracts shared across processes
spec/           Product specification and implementation plan
```

## Data and backups

The live database is stored under Electron's platform-specific `userData`
directory, not in a cloud-synced folder. When a backup folder is configured,
transactionally consistent snapshots are placed in its `backups/` directory.
LastTodo checks on launch and once an hour, creates at most one snapshot per
calendar day, and retains snapshots for up to 15 days.

## License

[MIT](LICENSE)
