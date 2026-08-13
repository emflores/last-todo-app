import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { AppDatabase } from './database/database';
import { registerIpcHandlers } from './ipc';
import { BackupService } from './services/backupService';
import { SettingsStore } from './services/settingsStore';
import { TaxonomyService } from './services/taxonomyService';
import { TodoService } from './services/todoService';
import { UpdateService } from './services/updateService';

let database: AppDatabase | null = null;
let backups: BackupService | null = null;
let updates: UpdateService | null = null;
let shutDown = false;

function shutdown(): void {
  if (shutDown) return;
  shutDown = true;
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
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

app.whenReady().then(() => {
  const userData = storageDirectory();
  const settings = new SettingsStore(path.join(userData, 'settings.json'));
  const databasePath = path.join(userData, 'todos.db');
  BackupService.restoreOnFreshInstall(databasePath, settings.backupFolder);
  database = new AppDatabase(databasePath);
  const todos = new TodoService(database);
  const taxonomy = new TaxonomyService(database);
  backups = new BackupService(database, settings);
  updates = new UpdateService();
  registerIpcHandlers(todos, taxonomy, backups, updates);
  backups.start();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shutdown();
});
