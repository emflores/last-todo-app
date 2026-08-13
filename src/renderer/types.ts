export type LabelScope = 'universal' | 'type';
export type Cardinality = 'single' | 'multi';

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
  cardinality: Cardinality;
  quickFilter: boolean;
  sortOrder: number;
  values: LabelValue[];
}

export interface TodoLabel {
  labelId: string;
  labelValueId: string;
  labelName: string;
  value: string;
}

export interface TodoLink {
  id?: string;
  label: string;
  url: string;
}

export interface Todo {
  id: string;
  title: string;
  typeId: string | null;
  dueDate: string | null;
  description: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sensitive: boolean;
  labels: TodoLabel[];
  links: TodoLink[];
  children: Todo[];
}

export interface TodoDraft {
  title: string;
  typeId: string | null;
  dueDate: string | null;
  description: string;
  parentId: string | null;
  sensitive: boolean;
  labelValueIds: string[];
  links: Array<{ label?: string; url: string }>;
}

export interface AppData {
  todos: Todo[];
  types: TodoType[];
  labels: LabelDefinition[];
}

export interface BackupStatus {
  folder: string | null;
  backupDirectory: string | null;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
  lastError: string | null;
}

export type ViewName = 'board' | 'settings';
