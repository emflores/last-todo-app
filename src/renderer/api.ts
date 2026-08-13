import type {
  CreateLabelInput,
  CreateTodoInput,
  Todo as ContractTodo,
  TodoAPI as ContractAPI,
  UpdateStatus,
} from '../shared/contracts';
import type {
  AppData,
  BackupStatus,
  Cardinality,
  LabelScope,
  Todo,
  TodoDraft,
  ValueKind,
} from './types';

export interface TodoAPI {
  getAppData(): Promise<AppData>;
  createTodo(input: TodoDraft): Promise<Todo>;
  updateTodo(id: string, input: TodoDraft): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
  setTodoCompleted(id: string, completed: boolean): Promise<Todo>;
  createType(input: { name: string; emoji?: string }): Promise<void>;
  updateType(
    id: string,
    input: { name?: string; emoji?: string },
  ): Promise<void>;
  deleteType(id: string): Promise<void>;
  createLabel(input: {
    name: string;
    scope: LabelScope;
    gatedTypeId: string | null;
    valueKind: ValueKind;
    cardinality: Cardinality;
  }): Promise<void>;
  updateLabel(id: string, input: { name: string }): Promise<void>;
  deleteLabel(id: string): Promise<void>;
  createLabelValue(labelId: string, input: { value: string }): Promise<void>;
  updateLabelValue(id: string, input: { value: string }): Promise<void>;
  deleteLabelValue(id: string): Promise<void>;
  getBackupStatus(): Promise<BackupStatus>;
  chooseBackupFolder(): Promise<BackupStatus>;
  runBackup(): Promise<BackupStatus>;
  restoreLatestBackup(): Promise<BackupStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  openUpdateDownload(): Promise<void>;
  getOnboardingStatus(): Promise<{ complete: boolean }>;
  completeOnboarding(): Promise<void>;
}

function bridge(): ContractAPI {
  const candidate = (window as unknown as { todoAPI?: ContractAPI }).todoAPI;
  if (!candidate)
    throw new Error(
      'The LastTodo bridge is unavailable. Restart the desktop app.',
    );
  return candidate;
}

function normalize(raw: ContractTodo): Todo {
  return {
    id: raw.id,
    title: raw.title,
    typeId: raw.typeId,
    dueDate: raw.dueDate,
    description: raw.description ?? '',
    parentId: raw.parentId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    completedAt: raw.completedAt,
    sensitive: raw.sensitive,
    labels: raw.labels.flatMap((selection) =>
      selection.values.map((value) => ({
        labelId: selection.labelId,
        labelValueId: value.id,
        labelName: selection.labelName,
        value: value.value,
      })),
    ),
    links: raw.links.map((link) => ({
      id: link.id,
      label: link.label ?? '',
      url: link.url,
    })),
    children: [],
  };
}

function normalizeAll(rows: ContractTodo[]): Todo[] {
  const todos = rows.map(normalize);
  const byParent = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (todo.parentId)
      byParent.set(todo.parentId, [
        ...(byParent.get(todo.parentId) ?? []),
        todo,
      ]);
  }
  return todos.map((todo) => ({
    ...todo,
    children: byParent.get(todo.id) ?? [],
  }));
}

function serializeDraft(draft: TodoDraft, data: AppData): CreateTodoInput {
  return {
    title: draft.title,
    typeId: draft.typeId,
    dueDate: draft.dueDate,
    description: draft.description || null,
    parentId: draft.parentId,
    sensitive: draft.sensitive,
    labels: data.labels
      .map((label) => ({
        labelId: label.id,
        valueIds: draft.labelValueIds.filter((id) =>
          label.values.some((value) => value.id === id),
        ),
      }))
      .filter((selection) => selection.valueIds.length > 0),
    links: draft.links.map((link, index) => ({
      label: link.label || null,
      url: link.url,
      sortOrder: index,
    })),
  };
}

let cachedData: AppData = { todos: [], types: [], labels: [] };

export const todoApi: TodoAPI = {
  async getAppData() {
    const [todos, taxonomy] = await Promise.all([
      bridge().listTodos({ includeCompleted: true }),
      bridge().listTaxonomy(),
    ]);
    cachedData = { todos: normalizeAll(todos), ...taxonomy };
    return cachedData;
  },
  async createTodo(input) {
    return normalize(
      await bridge().createTodo(serializeDraft(input, cachedData)),
    );
  },
  async updateTodo(id, input) {
    return normalize(
      await bridge().updateTodo(id, serializeDraft(input, cachedData)),
    );
  },
  deleteTodo: (id) => bridge().deleteTodo(id),
  async setTodoCompleted(id, completed) {
    return normalize(await bridge().setTodoCompleted(id, completed));
  },
  async createType(input) {
    await bridge().createType(input);
  },
  async updateType(id, input) {
    await bridge().updateType(id, input);
  },
  deleteType: (id) => bridge().deleteType(id),
  async createLabel(input) {
    await bridge().createLabel(input as CreateLabelInput);
  },
  async updateLabel(id, input) {
    await bridge().updateLabel(id, input);
  },
  deleteLabel: (id) => bridge().deleteLabel(id),
  async createLabelValue(labelId, input) {
    await bridge().createLabelValue({ labelId, ...input });
  },
  async updateLabelValue(id, input) {
    await bridge().updateLabelValue(id, input);
  },
  deleteLabelValue: (id) => bridge().deleteLabelValue(id),
  getBackupStatus: () => bridge().getBackupStatus(),
  async chooseBackupFolder() {
    const status = await bridge().chooseBackupFolder();
    if (status.lastError) throw new Error(status.lastError);
    return status;
  },
  async runBackup() {
    const status = await bridge().runBackupNow();
    if (status.lastError) throw new Error(status.lastError);
    return status;
  },
  restoreLatestBackup: () => bridge().restoreLatestBackup(),
  checkForUpdates: () => bridge().checkForUpdates(),
  openUpdateDownload: () => bridge().openUpdateDownload(),
  getOnboardingStatus: () => bridge().getOnboardingStatus(),
  completeOnboarding: () => bridge().completeOnboarding(),
};
