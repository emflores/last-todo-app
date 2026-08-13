import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type CreateLabelInput,
  type CreateLabelValueInput,
  type CreateTodoInput,
  type CreateTypeInput,
  type RendererErrorReport,
  type TodoQuery,
  type UpdateLabelInput,
  type UpdateLabelValueInput,
  type UpdateTodoInput,
  type UpdateTypeInput,
} from '../shared/contracts';
import { BackupService } from './services/backupService';
import { AppLogger } from './services/appLogger';
import { TaxonomyService } from './services/taxonomyService';
import { TodoService } from './services/todoService';
import { UpdateService } from './services/updateService';

export function registerIpcHandlers(
  todos: TodoService,
  taxonomy: TaxonomyService,
  backups: BackupService,
  updates: UpdateService,
  logger: AppLogger,
): void {
  for (const channel of Object.values(IPC_CHANNELS))
    ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.bootstrap, () => ({
    todos: todos.list(),
    taxonomy: taxonomy.list(),
    backup: backups.status(),
  }));
  ipcMain.handle(IPC_CHANNELS.listTodos, (_event, query?: TodoQuery) =>
    todos.list(query),
  );
  ipcMain.handle(IPC_CHANNELS.getTodo, (_event, id: string) => todos.get(id));
  ipcMain.handle(IPC_CHANNELS.createTodo, (_event, input: CreateTodoInput) =>
    todos.create(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateTodo,
    (_event, id: string, input: UpdateTodoInput) => todos.update(id, input),
  );
  ipcMain.handle(IPC_CHANNELS.deleteTodo, (_event, id: string) =>
    todos.delete(id),
  );
  ipcMain.handle(
    IPC_CHANNELS.setTodoCompleted,
    (_event, id: string, completed: boolean) =>
      todos.setCompleted(id, completed),
  );

  ipcMain.handle(IPC_CHANNELS.listTaxonomy, () => taxonomy.list());
  ipcMain.handle(IPC_CHANNELS.createType, (_event, input: CreateTypeInput) =>
    taxonomy.createType(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateType,
    (_event, id: string, input: UpdateTypeInput) =>
      taxonomy.updateType(id, input),
  );
  ipcMain.handle(IPC_CHANNELS.deleteType, (_event, id: string) =>
    taxonomy.deleteType(id),
  );
  ipcMain.handle(IPC_CHANNELS.createLabel, (_event, input: CreateLabelInput) =>
    taxonomy.createLabel(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateLabel,
    (_event, id: string, input: UpdateLabelInput) =>
      taxonomy.updateLabel(id, input),
  );
  ipcMain.handle(IPC_CHANNELS.deleteLabel, (_event, id: string) =>
    taxonomy.deleteLabel(id),
  );
  ipcMain.handle(
    IPC_CHANNELS.createLabelValue,
    (_event, input: CreateLabelValueInput) => taxonomy.createValue(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.updateLabelValue,
    (_event, id: string, input: UpdateLabelValueInput) =>
      taxonomy.updateValue(id, input),
  );
  ipcMain.handle(IPC_CHANNELS.deleteLabelValue, (_event, id: string) =>
    taxonomy.deleteValue(id),
  );

  ipcMain.handle(IPC_CHANNELS.getBackupStatus, () => backups.status());
  ipcMain.handle(IPC_CHANNELS.chooseBackupFolder, () => backups.chooseFolder());
  ipcMain.handle(IPC_CHANNELS.runBackupNow, () => backups.runNow());
  ipcMain.handle(IPC_CHANNELS.restoreLatestBackup, () =>
    backups.restoreLatest(),
  );
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, () => updates.check());
  ipcMain.handle(IPC_CHANNELS.openUpdateDownload, () => updates.openDownload());

  ipcMain.removeAllListeners(IPC_CHANNELS.reportRendererError);
  ipcMain.on(IPC_CHANNELS.reportRendererError, (_event, value: unknown) => {
    const report = rendererErrorReport(value);
    if (report) logger.error('renderer-javascript-error', report);
  });
}

function rendererErrorReport(value: unknown): RendererErrorReport | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'error' && candidate.kind !== 'unhandled-rejection')
    return null;
  if (typeof candidate.message !== 'string') return null;

  return {
    kind: candidate.kind,
    message: candidate.message.slice(0, 2_000),
    ...(typeof candidate.stack === 'string'
      ? { stack: candidate.stack.slice(0, 12_000) }
      : {}),
    ...(typeof candidate.source === 'string'
      ? { source: candidate.source.slice(0, 1_000) }
      : {}),
    ...(typeof candidate.line === 'number' ? { line: candidate.line } : {}),
    ...(typeof candidate.column === 'number'
      ? { column: candidate.column }
      : {}),
  };
}
