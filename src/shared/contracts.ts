export type LabelScope = 'universal' | 'type';
export type LabelCardinality = 'single' | 'multi';

export interface TodoType {
  id: string;
  name: string;
  emoji: string;
  sortOrder: number;
}

export interface LabelValue {
  id: string;
  labelId: string;
  value: string;
  sortOrder: number;
}

export interface LabelDefinition {
  id: string;
  name: string;
  scope: LabelScope;
  gatedTypeIds: string[];
  cardinality: LabelCardinality;
  quickFilter: boolean;
  sortOrder: number;
  values: LabelValue[];
}

export interface Taxonomy {
  types: TodoType[];
  labels: LabelDefinition[];
}

export interface TodoLabelSelection {
  labelId: string;
  labelName: string;
  values: LabelValue[];
}

export interface TodoLink {
  id: string;
  label: string | null;
  url: string;
  sortOrder: number;
}

export interface Todo {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  dueDate: string | null;
  effectiveDueDate: string;
  description: string | null;
  parentId: string | null;
  parentTitle: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sensitive: boolean;
  labels: TodoLabelSelection[];
  links: TodoLink[];
  childProgress: { completed: number; total: number };
}

export interface TodoLabelInput {
  labelId: string;
  valueIds: string[];
}

export interface TodoLinkInput {
  id?: string;
  label?: string | null;
  url: string;
  sortOrder?: number;
}

export interface CreateTodoInput {
  title: string;
  typeId: string;
  dueDate?: string | null;
  description?: string | null;
  parentId?: string | null;
  sensitive?: boolean;
  labels?: TodoLabelInput[];
  links?: TodoLinkInput[];
}

export interface UpdateTodoInput {
  title?: string;
  typeId?: string;
  dueDate?: string | null;
  description?: string | null;
  parentId?: string | null;
  sensitive?: boolean;
  labels?: TodoLabelInput[];
  links?: TodoLinkInput[];
}

export interface TodoQuery {
  includeCompleted?: boolean;
  completedOnly?: boolean;
  typeIds?: string[];
  labelValueIds?: string[];
  search?: string;
  parentId?: string | null;
  rootOnly?: boolean;
  dueFrom?: string;
  dueTo?: string;
}

export interface CreateTypeInput {
  name: string;
  emoji?: string;
  sortOrder?: number;
}
export interface UpdateTypeInput {
  name?: string;
  emoji?: string;
  sortOrder?: number;
}
export interface CreateLabelInput {
  name: string;
  scope: LabelScope;
  gatedTypeIds?: string[];
  cardinality: LabelCardinality;
  quickFilter?: boolean;
  sortOrder?: number;
}
export type UpdateLabelInput = Partial<CreateLabelInput>;
export interface CreateLabelValueInput {
  labelId: string;
  value: string;
  sortOrder?: number;
}
export interface UpdateLabelValueInput {
  value?: string;
  sortOrder?: number;
}

export interface BackupStatus {
  folder: string | null;
  backupDirectory: string | null;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  lastError: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  downloadLabel: string | null;
  checkedAt: string;
  error: string | null;
}

export interface RendererErrorReport {
  kind: 'error' | 'unhandled-rejection';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
}

export interface BootstrapData {
  todos: Todo[];
  taxonomy: Taxonomy;
  backup: BackupStatus;
}

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  listTodos: 'todos:list',
  getTodo: 'todos:get',
  createTodo: 'todos:create',
  updateTodo: 'todos:update',
  deleteTodo: 'todos:delete',
  setTodoCompleted: 'todos:set-completed',
  listTaxonomy: 'taxonomy:list',
  createType: 'types:create',
  updateType: 'types:update',
  deleteType: 'types:delete',
  createLabel: 'labels:create',
  updateLabel: 'labels:update',
  deleteLabel: 'labels:delete',
  createLabelValue: 'label-values:create',
  updateLabelValue: 'label-values:update',
  deleteLabelValue: 'label-values:delete',
  getBackupStatus: 'backups:status',
  chooseBackupFolder: 'backups:choose-folder',
  runBackupNow: 'backups:run-now',
  restoreFromBackup: 'backups:restore-from-backup',
  checkForUpdates: 'updates:check',
  openUpdateDownload: 'updates:open-download',
  getOnboardingStatus: 'onboarding:status',
  completeOnboarding: 'onboarding:complete',
  setOnboardingComplete: 'onboarding:set-complete',
  reportRendererError: 'diagnostics:renderer-error',
} as const;

export interface TodoAPI {
  bootstrap(): Promise<BootstrapData>;
  listTodos(query?: TodoQuery): Promise<Todo[]>;
  getTodo(id: string): Promise<Todo>;
  createTodo(input: CreateTodoInput): Promise<Todo>;
  updateTodo(id: string, input: UpdateTodoInput): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
  setTodoCompleted(id: string, completed: boolean): Promise<Todo>;
  listTaxonomy(): Promise<Taxonomy>;
  createType(input: CreateTypeInput): Promise<TodoType>;
  updateType(id: string, input: UpdateTypeInput): Promise<TodoType>;
  deleteType(id: string): Promise<void>;
  createLabel(input: CreateLabelInput): Promise<LabelDefinition>;
  updateLabel(id: string, input: UpdateLabelInput): Promise<LabelDefinition>;
  deleteLabel(id: string): Promise<void>;
  createLabelValue(input: CreateLabelValueInput): Promise<LabelValue>;
  updateLabelValue(
    id: string,
    input: UpdateLabelValueInput,
  ): Promise<LabelValue>;
  deleteLabelValue(id: string): Promise<void>;
  getBackupStatus(): Promise<BackupStatus>;
  chooseBackupFolder(): Promise<BackupStatus>;
  runBackupNow(): Promise<BackupStatus>;
  restoreFromBackup(): Promise<BackupStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  openUpdateDownload(): Promise<void>;
  getOnboardingStatus(): Promise<{ complete: boolean }>;
  completeOnboarding(): Promise<void>;
  setOnboardingComplete(complete: boolean): Promise<void>;
}
