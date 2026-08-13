import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type CreateLabelInput,
  type CreateLabelValueInput,
  type CreateTodoInput,
  type CreateTypeInput,
  type TodoAPI,
  type TodoQuery,
  type UpdateLabelInput,
  type UpdateLabelValueInput,
  type UpdateTodoInput,
  type UpdateTypeInput,
} from '../shared/contracts';

const todoAPI = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  listTodos: (query?: TodoQuery) =>
    ipcRenderer.invoke(IPC_CHANNELS.listTodos, query),
  getTodo: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getTodo, id),
  createTodo: (input: CreateTodoInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createTodo, input),
  updateTodo: (id: string, input: UpdateTodoInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateTodo, id, input),
  deleteTodo: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteTodo, id),
  setTodoCompleted: (id: string, completed: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setTodoCompleted, id, completed),
  listTaxonomy: () => ipcRenderer.invoke(IPC_CHANNELS.listTaxonomy),
  createType: (input: CreateTypeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createType, input),
  updateType: (id: string, input: UpdateTypeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateType, id, input),
  deleteType: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteType, id),
  createLabel: (input: CreateLabelInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createLabel, input),
  updateLabel: (id: string, input: UpdateLabelInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateLabel, id, input),
  deleteLabel: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteLabel, id),
  createLabelValue: (input: CreateLabelValueInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createLabelValue, input),
  updateLabelValue: (id: string, input: UpdateLabelValueInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateLabelValue, id, input),
  deleteLabelValue: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteLabelValue, id),
  getBackupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getBackupStatus),
  chooseBackupFolder: () => ipcRenderer.invoke(IPC_CHANNELS.chooseBackupFolder),
  runBackupNow: () => ipcRenderer.invoke(IPC_CHANNELS.runBackupNow),
  restoreFromBackup: () => ipcRenderer.invoke(IPC_CHANNELS.restoreFromBackup),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  openUpdateDownload: () => ipcRenderer.invoke(IPC_CHANNELS.openUpdateDownload),
  getOnboardingStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getOnboardingStatus),
  completeOnboarding: () => ipcRenderer.invoke(IPC_CHANNELS.completeOnboarding),
  setOnboardingComplete: (complete: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setOnboardingComplete, complete),
} satisfies TodoAPI;

contextBridge.exposeInMainWorld('todoAPI', todoAPI);

function text(value: unknown, maxLength: number): string {
  const result = value instanceof Error ? value.message : String(value);
  return result.slice(0, maxLength);
}

interface RendererWindow {
  addEventListener(
    type: 'error',
    listener: (event: {
      error: unknown;
      message: string;
      filename: string;
      lineno: number;
      colno: number;
    }) => void,
  ): void;
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: { reason: unknown }) => void,
  ): void;
}

const rendererWindow = globalThis as unknown as RendererWindow;

rendererWindow.addEventListener('error', (event) => {
  ipcRenderer.send(IPC_CHANNELS.reportRendererError, {
    kind: 'error',
    message: text(event.error ?? event.message, 2_000),
    stack:
      event.error instanceof Error
        ? event.error.stack?.slice(0, 12_000)
        : undefined,
    source: event.filename?.slice(0, 1_000),
    line: event.lineno,
    column: event.colno,
  });
});

rendererWindow.addEventListener('unhandledrejection', (event) => {
  ipcRenderer.send(IPC_CHANNELS.reportRendererError, {
    kind: 'unhandled-rejection',
    message: text(event.reason, 2_000),
    stack:
      event.reason instanceof Error
        ? event.reason.stack?.slice(0, 12_000)
        : undefined,
  });
});
