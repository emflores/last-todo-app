import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { AppDatabase } from './database/database';
import { registerIpcHandlers } from './ipc';
import { BackupService } from './services/backupService';
import { AppLogger, describeError, rotateLogFile } from './services/appLogger';
import { SettingsStore } from './services/settingsStore';
import { TaxonomyService } from './services/taxonomyService';
import { TodoService } from './services/todoService';
import { UpdateService } from './services/updateService';

app.setAppLogsPath();
const logDirectory = app.getPath('logs');
const logger = new AppLogger(logDirectory);
const chromiumLogPath = path.join(logDirectory, 'chromium.log');
rotateLogFile(chromiumLogPath);
app.commandLine.appendSwitch('enable-logging', 'file');
app.commandLine.appendSwitch('log-file', chromiumLogPath);

console.info(`LastTodo diagnostic logs: ${logDirectory}`);
logger.info('process-start', {
  version: app.getVersion(),
  packaged: app.isPackaged,
  platform: process.platform,
  architecture: process.arch,
  electron: process.versions.electron,
  node: process.versions.node,
});

process.on('uncaughtExceptionMonitor', (error, origin) => {
  logger.error('uncaught-main-process-exception', {
    origin,
    ...describeError(error),
  });
});
process.on('warning', (warning) => {
  logger.warn('main-process-warning', describeError(warning));
});
process.on('exit', (code) => logger.info('process-exit', { code }));

app.on('render-process-gone', (_event, webContents, details) => {
  logger.error('renderer-process-gone', {
    webContentsId: webContents.id,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});
app.on('child-process-gone', (_event, details) => {
  logger.error('electron-child-process-gone', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName,
    name: details.name,
  });
});

let database: AppDatabase | null = null;
let backups: BackupService | null = null;
let updates: UpdateService | null = null;
let shutDown = false;

function shutdown(): void {
  if (shutDown) return;
  shutDown = true;
  logger.info('shutdown-started');
  backups?.stop();
  database?.close();
  updates = null;
  backups = null;
  database = null;
}

function storageDirectory(): string {
  const current = app.getPath('userData');
  if (app.commandLine.hasSwitch('user-data-dir')) return current;

  // Keep using an existing database created before the CustomTodo → LastTodo
  // rename. New installations use LastTodo's normal userData directory.
  const legacy = path.join(app.getPath('appData'), 'custom-todo');
  if (
    !fs.existsSync(path.join(current, 'todos.db')) &&
    fs.existsSync(path.join(legacy, 'todos.db'))
  ) {
    return legacy;
  }
  return current;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'LastTodo',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  logger.info('window-created', {
    windowId: window.id,
    webContentsId: window.webContents.id,
  });
  window.webContents.on('unresponsive', () => {
    logger.warn('renderer-unresponsive', {
      webContentsId: window.webContents.id,
    });
  });
  window.webContents.on('responsive', () => {
    logger.info('renderer-responsive', {
      webContentsId: window.webContents.id,
    });
  });
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      logger.error('renderer-load-failed', {
        webContentsId: window.webContents.id,
        errorCode,
        errorDescription,
        location: pageLocation(validatedURL),
      });
    },
  );
  window.on('closed', () =>
    logger.info('window-closed', { windowId: window.id }),
  );
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  const loaded = developmentUrl
    ? window.loadURL(developmentUrl)
    : window.loadFile(path.join(__dirname, '../renderer/index.html'));
  void loaded.catch((error) =>
    logger.error('renderer-load-rejected', describeError(error)),
  );
  return window;
}

function pageLocation(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' ? 'file:' : url.origin;
  } catch {
    return 'unknown';
  }
}

void app
  .whenReady()
  .then(() => {
    const userData = storageDirectory();
    const settings = new SettingsStore(path.join(userData, 'settings.json'));
    const databasePath = path.join(userData, 'todos.db');
    BackupService.restoreOnFreshInstall(databasePath, settings.backupFolder);
    database = new AppDatabase(databasePath);
    const todos = new TodoService(database);
    const taxonomy = new TaxonomyService(database);
    backups = new BackupService(database, settings);
    updates = new UpdateService(logger);
    registerIpcHandlers(todos, taxonomy, backups, updates, logger);
    backups.start();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    logger.error('application-startup-failed', describeError(error));
    console.error('LastTodo failed to start:', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdown();
});
