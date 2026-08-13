import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  canMoveBetweenLanes,
  dueDateRange,
  isDueDateInLane,
  isReschedulableLane,
  proposedDueDate,
  type ReschedulableLane,
} from '../shared/boardScheduling';
import type { UpdateStatus } from '../shared/contracts';
import { todoApi } from './api';
import lastTodoLogo from './assets/lasttodo-logo.png';
import type {
  AppData,
  BackupStatus,
  LabelDefinition,
  Todo,
  TodoDraft,
  TodoType,
  ViewName,
} from './types';

const EMPTY_DATA: AppData = { todos: [], types: [], labels: [] };
const EMPTY_DRAFT: TodoDraft = {
  title: '',
  typeId: null,
  dueDate: localISO(new Date()),
  description: '',
  parentId: null,
  sensitive: false,
  labelValueIds: [],
  links: [],
};

type LaneKey = 'overdue' | 'today' | 'week' | 'month' | 'future';
interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface ConfirmationState extends ConfirmationOptions {
  resolve: (confirmed: boolean) => void;
}
interface RescheduleState {
  todo: Todo;
  targetLane: ReschedulableLane;
  proposedDate: string;
}
interface TaskCreatedToastState {
  id: number;
  currentTypeName: string;
  createdTypeName: string;
  hiddenFromCurrentView: boolean;
}
type LayoutMode = 'board' | 'list';
type StatusFilter = 'active' | 'all' | 'completed';
type DueFilter = 'any' | LaneKey;
type PriorityFilter = 'any' | 'high' | 'medium' | 'low' | 'none';
type SortMode = 'due' | 'priority' | 'created' | 'title';
type SettingsTab = 'types' | 'labels' | 'backup' | 'updates' | 'debug';
type OnboardingStep = 1 | 2 | 3 | 4;
const TYPE_EMOJI_OPTIONS = [
  ['🏷️', 'Label'],
  ['🤝', 'Team'],
  ['👥', 'People'],
  ['🧩', 'Product'],
  ['⚙️', 'Operations'],
  ['💼', 'Work'],
  ['🏠', 'Home'],
  ['🎯', 'Goal'],
  ['🚀', 'Launch'],
  ['💡', 'Idea'],
  ['📌', 'Important'],
  ['📅', 'Schedule'],
  ['✅', 'Tasks'],
  ['🛠️', 'Project'],
  ['📣', 'Marketing'],
  ['💰', 'Finance'],
  ['❤️', 'Personal'],
  ['🌱', 'Growth'],
  ['📚', 'Learning'],
  ['🧭', 'Strategy'],
  ['🛒', 'Errands'],
  ['🧪', 'Experiment'],
  ['🔒', 'Private'],
  ['⭐', 'Favorite'],
] as const;
const DEFAULT_TYPE_EMOJI = TYPE_EMOJI_OPTIONS[0][0];
type IconName =
  | 'inbox'
  | 'people'
  | 'settings'
  | 'search'
  | 'plus'
  | 'x'
  | 'more'
  | 'link'
  | 'chevron'
  | 'check'
  | 'board'
  | 'list'
  | 'filter'
  | 'lock'
  | 'alert'
  | 'sun'
  | 'calendar'
  | 'horizon'
  | 'sparkle';
const LANES: Array<{
  id: LaneKey;
  title: string;
  eyebrow: string;
  emptyTitle: string;
  emptyCopy: string;
  emptyIcon: IconName;
}> = [
  {
    id: 'overdue',
    title: 'Overdue',
    eyebrow: 'Needs attention',
    emptyTitle: 'All caught up',
    emptyCopy: 'Nothing needs rescuing.',
    emptyIcon: 'sparkle',
  },
  {
    id: 'today',
    title: 'Today',
    eyebrow: 'Focus',
    emptyTitle: 'Today is yours',
    emptyCopy: 'A clear day is a good day.',
    emptyIcon: 'sun',
  },
  {
    id: 'week',
    title: 'Next 7 days',
    eyebrow: 'Coming up',
    emptyTitle: 'Open runway',
    emptyCopy: 'Nothing queued this week.',
    emptyIcon: 'calendar',
  },
  {
    id: 'month',
    title: 'Next 30 days',
    eyebrow: 'On the horizon',
    emptyTitle: 'Plenty of space',
    emptyCopy: 'The near horizon is clear.',
    emptyIcon: 'horizon',
  },
  {
    id: 'future',
    title: 'Future',
    eyebrow: 'Later',
    emptyTitle: 'Room to dream',
    emptyCopy: 'Future plans will land here.',
    emptyIcon: 'sparkle',
  },
];

function localISO(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function plusDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return localISO(copy);
}

function effectiveDate(todo: Todo, all: Todo[]): string | null {
  if (todo.dueDate) return todo.dueDate;
  return (
    all.find((candidate) => candidate.id === todo.parentId)?.dueDate ?? null
  );
}

function laneFor(todo: Todo, all: Todo[]): LaneKey {
  const due = effectiveDate(todo, all) ?? '9999-12-31';
  const now = new Date();
  const today = localISO(now);
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due <= plusDays(now, 7)) return 'week';
  if (due <= plusDays(now, 30)) return 'month';
  return 'future';
}

function niceDate(value: string | null) {
  if (!value) return 'Inherits date';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function priority(todo: Todo) {
  const value = todo.labels
    .find((label) => label.labelName.toLowerCase() === 'priority')
    ?.value.toLowerCase();
  return value === 'high'
    ? 3
    : value === 'medium' || value === 'med'
      ? 2
      : value === 'low'
        ? 1
        : 0;
}

function priorityName(todo: Todo): Exclude<PriorityFilter, 'any'> {
  const score = priority(todo);
  return score === 3
    ? 'high'
    : score === 2
      ? 'medium'
      : score === 1
        ? 'low'
        : 'none';
}

function compareTodos(a: Todo, b: Todo, all: Todo[], sort: SortMode) {
  const aDate = effectiveDate(a, all) ?? '9999-12-31';
  const bDate = effectiveDate(b, all) ?? '9999-12-31';
  if (sort === 'priority')
    return priority(b) - priority(a) || aDate.localeCompare(bDate);
  if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
  if (sort === 'title') return a.title.localeCompare(b.title);
  return (
    aDate.localeCompare(bDate) ||
    priority(b) - priority(a) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function flattenTodos(todos: Todo[]) {
  const childIds = new Set(
    todos.flatMap((todo) => todo.children?.map((child) => child.id) ?? []),
  );
  const top = todos.filter((todo) => !todo.parentId && !childIds.has(todo.id));
  return top.map((todo) => ({
    ...todo,
    children:
      todo.children ?? todos.filter((child) => child.parentId === todo.id),
  }));
}

function Icon({ name }: { name: IconName }) {
  const paths = {
    inbox: (
      <>
        <path d="M4 5.5h16v13H4z" />
        <path d="M4 14h4l1.5 2h5L16 14h4" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.3-4 2.1-6 5.5-6s5.2 2 5.5 6M15 5.3a3 3 0 0 1 0 5.4M16 13c2.8.3 4.2 2.3 4.5 5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    x: <path d="m6 6 12 12M18 6 6 18" />,
    more: (
      <>
        <circle cx="5" cy="12" r=".7" fill="currentColor" />
        <circle cx="12" cy="12" r=".7" fill="currentColor" />
        <circle cx="19" cy="12" r=".7" fill="currentColor" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    board: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="16" rx="1" />
        <rect x="17" y="4" width="4" height="16" rx="1" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="4" cy="6" r=".8" fill="currentColor" />
        <circle cx="4" cy="12" r=".8" fill="currentColor" />
        <circle cx="4" cy="18" r=".8" fill="currentColor" />
      </>
    ),
    filter: (
      <>
        <path d="M4 6h16M7 12h10M10 18h4" />
        <circle cx="9" cy="6" r="1.5" fill="currentColor" />
        <circle cx="14" cy="12" r="1.5" fill="currentColor" />
        <circle cx="12" cy="18" r="1.5" fill="currentColor" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2.8 19h18.4L12 3Z" />
        <path d="M12 9v4M12 16.5v.2" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3" />
      </>
    ),
    horizon: (
      <>
        <path d="M3 18h18M5 15a7 7 0 0 1 14 0M12 4v3M5.5 7.5l2 2M18.5 7.5l-2 2" />
      </>
    ),
    sparkle: (
      <>
        <path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6L19 13Z" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}

export function App() {
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewName>('board');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedQuickFilters, setSelectedQuickFilters] = useState<
    Record<string, string>
  >({});
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<LayoutMode>(() =>
    window.localStorage.getItem('lasttodo:layout') === 'list'
      ? 'list'
      : 'board',
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [dueFilter, setDueFilter] = useState<DueFilter>('any');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('any');
  const [sortMode, setSortMode] = useState<SortMode>('due');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const [editing, setEditing] = useState<Todo | null | undefined>(undefined);
  const [quickParentId, setQuickParentId] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('types');
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    null,
  );
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<LaneKey | null>(null);
  const [reschedule, setReschedule] = useState<RescheduleState | null>(null);
  const [taskCreatedToast, setTaskCreatedToast] =
    useState<TaskCreatedToastState | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      setData(await todoApi.getAppData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load your tasks.',
      );
    } finally {
      setLoading(false);
    }
  };

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try {
      const status = await todoApi.checkForUpdates();
      setUpdateStatus(status);
      if (status.updateAvailable) setUpdateBannerDismissed(false);
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const openUpdateDownload = async () => {
    try {
      setError(null);
      await todoApi.openUpdateDownload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not open the update download.',
      );
    }
  };
  const finishOnboarding = useCallback(async () => {
    setOnboardingStep(null);
    try {
      await todoApi.completeOnboarding();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save your welcome tour progress.',
      );
    }
  }, []);
  const requestConfirmation = useCallback(
    (options: ConfirmationOptions): Promise<boolean> =>
      new Promise((resolve) => setConfirmation({ ...options, resolve })),
    [],
  );
  const settleConfirmation = (confirmed: boolean) => {
    const current = confirmation;
    setConfirmation(null);
    current?.resolve(confirmed);
  };

  useEffect(() => {
    void refresh();
    todoApi
      .getBackupStatus()
      .then(setBackupStatus)
      .catch(() => undefined);
    void checkForUpdates();
    todoApi
      .getOnboardingStatus()
      .then(({ complete }) => {
        if (!complete) {
          setView('board');
          setSelectedType('all');
          setSelectedQuickFilters({});
          setLayout('board');
          setOnboardingStep(1);
        }
      })
      .catch(() => undefined);
  }, [checkForUpdates]);
  useEffect(() => {
    window.localStorage.setItem('lasttodo:layout', layout);
  }, [layout]);
  useEffect(() => {
    if (!taskCreatedToast) return;
    const timeout = window.setTimeout(() => setTaskCreatedToast(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [taskCreatedToast]);
  useEffect(() => {
    if (
      selectedType !== 'all' &&
      !data.types.some((type) => type.id === selectedType)
    ) {
      setSelectedType('all');
      setSelectedQuickFilters({});
    }
  }, [data.types, selectedType]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (onboardingStep) {
        if (event.key === 'Escape') {
          event.preventDefault();
          void finishOnboarding();
        }
        return;
      }
      if (confirmation || reschedule) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (confirmation) {
            setConfirmation(null);
            confirmation.resolve(false);
          } else {
            setReschedule(null);
          }
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setQuickParentId(null);
        setEditing(null);
      }
      if (event.key === 'Escape') setEditing(undefined);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmation, finishOnboarding, onboardingStep, reschedule]);

  const visibleTodos = useMemo(() => {
    if (showSensitive) return data.todos;
    const sensitiveIds = new Set(
      data.todos.filter((todo) => todo.sensitive).map((todo) => todo.id),
    );
    const visible = data.todos.filter(
      (todo) =>
        !todo.sensitive && (!todo.parentId || !sensitiveIds.has(todo.parentId)),
    );
    const visibleIds = new Set(visible.map((todo) => todo.id));
    return visible.map((todo) => ({
      ...todo,
      children: todo.children.filter((child) => visibleIds.has(child.id)),
    }));
  }, [data.todos, showSensitive]);
  const parents = useMemo(() => flattenTodos(visibleTodos), [visibleTodos]);
  const quickFilterLabels = useMemo(
    () =>
      data.labels.filter(
        (label) =>
          label.quickFilter &&
          label.values.length > 0 &&
          (label.scope === 'universal' ||
            label.gatedTypeIds.includes(selectedType)),
      ),
    [data.labels, selectedType],
  );
  const activeQuickFilterValueIds = useMemo(
    () =>
      quickFilterLabels.flatMap((label) => {
        const selected = selectedQuickFilters[label.id];
        return selected && label.values.some((value) => value.id === selected)
          ? [selected]
          : [];
      }),
    [quickFilterLabels, selectedQuickFilters],
  );
  const activeCount = parents.filter((todo) => !todo.completedAt).length;
  const filtered = useMemo(
    () =>
      parents
        .filter((todo) => {
          if (statusFilter === 'active' && todo.completedAt) return false;
          if (statusFilter === 'completed' && !todo.completedAt) return false;
          if (selectedType !== 'all' && todo.typeId !== selectedType)
            return false;
          if (
            !activeQuickFilterValueIds.every((valueId) =>
              todo.labels.some((label) => label.labelValueId === valueId),
            )
          )
            return false;
          const needle = query.trim().toLowerCase();
          if (
            needle &&
            ![
              todo.title,
              todo.description,
              ...todo.labels.map((label) => label.value),
            ]
              .join(' ')
              .toLowerCase()
              .includes(needle)
          )
            return false;
          if (dueFilter !== 'any' && laneFor(todo, visibleTodos) !== dueFilter)
            return false;
          if (priorityFilter !== 'any' && priorityName(todo) !== priorityFilter)
            return false;
          return true;
        })
        .sort((a, b) => compareTodos(a, b, visibleTodos, sortMode)),
    [
      parents,
      statusFilter,
      selectedType,
      activeQuickFilterValueIds,
      query,
      dueFilter,
      priorityFilter,
      visibleTodos,
      sortMode,
    ],
  );

  const lanes = useMemo(
    () =>
      Object.fromEntries(
        LANES.map((lane) => [
          lane.id,
          filtered.filter((todo) => laneFor(todo, visibleTodos) === lane.id),
        ]),
      ) as Record<LaneKey, Todo[]>,
    [filtered, visibleTodos],
  );
  const selectedTypeName = data.types.find(
    (type) => type.id === selectedType,
  )?.name;
  const title = selectedTypeName ?? 'All tasks';

  const mutate = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'That change could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openCreate = (parentId: string | null = null) => {
    setQuickParentId(parentId);
    setEditing(null);
  };
  const selectTypeView = (typeId: string) => {
    setView('board');
    setSelectedType(typeId);
    setSelectedQuickFilters({});
  };
  const hasActiveFilters =
    activeQuickFilterValueIds.length > 0 ||
    dueFilter !== 'any' ||
    priorityFilter !== 'any' ||
    statusFilter !== 'active' ||
    sortMode !== 'due';
  const resetFilters = () => {
    setSelectedQuickFilters({});
    setDueFilter('any');
    setPriorityFilter('any');
    setStatusFilter('active');
    setSortMode('due');
  };
  const startTaskDrag = (event: React.DragEvent<HTMLElement>, todo: Todo) => {
    const sourceLane = laneFor(todo, visibleTodos);
    const target = event.target as HTMLElement;
    if (
      todo.completedAt ||
      !isReschedulableLane(sourceLane) ||
      target.closest('button, input, select, textarea, a')
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', todo.id);
    const card = event.currentTarget.closest('.task-card');
    if (card instanceof HTMLElement) {
      const bounds = card.getBoundingClientRect();
      event.dataTransfer.setDragImage(
        card,
        Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
        Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
      );
    }
    setDraggingTodoId(todo.id);
  };
  const laneAcceptsDrag = (targetLane: LaneKey): boolean => {
    const todo = parents.find((candidate) => candidate.id === draggingTodoId);
    return Boolean(
      todo && canMoveBetweenLanes(laneFor(todo, visibleTodos), targetLane),
    );
  };
  const dropTask = (
    event: React.DragEvent<HTMLDivElement>,
    targetLane: LaneKey,
  ) => {
    event.preventDefault();
    const id = draggingTodoId ?? event.dataTransfer.getData('text/plain');
    const todo = parents.find((candidate) => candidate.id === id);
    setDraggingTodoId(null);
    setDragOverLane(null);
    if (!todo || !canMoveBetweenLanes(laneFor(todo, visibleTodos), targetLane))
      return;
    setReschedule({
      todo,
      targetLane,
      proposedDate: proposedDueDate(targetLane, localISO(new Date())),
    });
  };
  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark">
            <img src={lastTodoLogo} alt="" />
          </span>
          <span>LastTodo</span>
        </div>
        <button
          className={`rail-row ${view === 'board' && selectedType === 'all' ? 'active' : ''}`}
          onClick={() => {
            setView('board');
            setSelectedType('all');
            setSelectedQuickFilters({});
          }}
        >
          <Icon name="inbox" />
          <span>All tasks</span>
          <span className="count">{activeCount}</span>
        </button>
        {data.types.length > 0 && (
          <div
            className={`rail-types ${onboardingStep === 4 ? 'onboarding-target' : ''}`}
          >
            <div className="rail-section-heading">
              <span>Types</span>
            </div>
            <nav aria-label="Task types">
              {data.types.map((type) => (
                <button
                  key={type.id}
                  className={`rail-row ${view !== 'settings' && selectedType === type.id ? 'active' : ''}`}
                  onClick={() => selectTypeView(type.id)}
                >
                  <span className="type-emoji" aria-hidden="true">
                    {type.emoji}
                  </span>
                  <span>{type.name}</span>
                </button>
              ))}
            </nav>
          </div>
        )}
        <div className="rail-spacer" />
        <button
          className={`rail-row ${view === 'settings' ? 'active' : ''}`}
          onClick={() => {
            setSettingsTab('types');
            setView('settings');
          }}
        >
          <Icon name="settings" />
          <span>Settings</span>
        </button>
        <div className="profile">
          <span className="avatar">M</span>
          <div>
            <strong>My workspace</strong>
            <small>Local & private</small>
          </div>
        </div>
      </aside>

      <main className="main">
        {view !== 'settings' && (
          <>
            <header className="topbar">
              <label className="search">
                <Icon name="search" />
                <input
                  aria-label="Search tasks"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search this view…"
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </label>
              <button
                className={`primary ${onboardingStep === 2 ? 'onboarding-target' : ''}`}
                onClick={() => openCreate()}
              >
                <Icon name="plus" />
                New task <kbd>⌘N</kbd>
              </button>
            </header>
            {updateStatus?.updateAvailable && !updateBannerDismissed && (
              <UpdateAvailableBanner
                version={updateStatus.latestVersion!}
                downloadLabel={updateStatus.downloadLabel!}
                onDownload={() => void openUpdateDownload()}
                onDismiss={() => setUpdateBannerDismissed(true)}
              />
            )}
            {backupStatus && !backupStatus.folder && !backupBannerDismissed && (
              <BackupDisabledBanner
                onDismiss={() => setBackupBannerDismissed(true)}
                onOpenSettings={() => {
                  setSettingsTab('backup');
                  setView('settings');
                }}
              />
            )}
            <section className="view-heading">
              <div>
                <p className="eyebrow">{timeGreeting()}</p>
                <h1>{title}</h1>
                <p>
                  {filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}{' '}
                  across your schedule
                </p>
              </div>
              <div className="layout-switch" aria-label="Task layout">
                <button
                  className={layout === 'board' ? 'active' : ''}
                  aria-pressed={layout === 'board'}
                  onClick={() => {
                    setLayout('board');
                    setDueFilter('any');
                  }}
                >
                  <Icon name="board" />
                  Board
                </button>
                <button
                  className={layout === 'list' ? 'active' : ''}
                  aria-pressed={layout === 'list'}
                  onClick={() => setLayout('list')}
                >
                  <Icon name="list" />
                  List
                </button>
              </div>
            </section>
            {quickFilterLabels.length > 0 && (
              <QuickFilterPanel
                labels={quickFilterLabels}
                selected={selectedQuickFilters}
                onChange={(labelId, valueId) =>
                  setSelectedQuickFilters((current) => {
                    if (valueId) return { ...current, [labelId]: valueId };
                    const next = { ...current };
                    delete next[labelId];
                    return next;
                  })
                }
              />
            )}
            <div className="filter-controls">
              <label className="sensitive-view-toggle">
                <input
                  type="checkbox"
                  checked={showSensitive}
                  onChange={(event) => setShowSensitive(event.target.checked)}
                />
                <span className="sensitive-switch" aria-hidden="true" />
                <Icon name="lock" />
                Show sensitive
              </label>
              <button
                className={`filter-toggle ${filtersExpanded ? 'active' : ''}`}
                aria-expanded={filtersExpanded}
                aria-controls="task-filters"
                onClick={() => setFiltersExpanded((expanded) => !expanded)}
              >
                <Icon name="filter" />
                Filters
                {hasActiveFilters && <span className="filter-active-dot" />}
                <Icon name="chevron" />
              </button>
            </div>
            {filtersExpanded && (
              <FilterBar
                types={selectedType === 'all' ? data.types : []}
                selectedType={selectedType}
                onTypeChange={selectTypeView}
                due={dueFilter}
                onDueChange={setDueFilter}
                showDueFilter={layout === 'list'}
                priorityFilter={priorityFilter}
                onPriorityChange={setPriorityFilter}
                status={statusFilter}
                onStatusChange={setStatusFilter}
                sort={sortMode}
                onSortChange={setSortMode}
                hasActiveFilters={hasActiveFilters}
                onReset={resetFilters}
              />
            )}
            {error && <ErrorBanner message={error} retry={refresh} />}
            {loading ? (
              <BoardSkeleton />
            ) : layout === 'board' ? (
              <section
                className={`board ${onboardingStep === 3 ? 'onboarding-target onboarding-board-target' : ''}`}
                aria-label="Tasks by due date"
              >
                {LANES.map((lane) => (
                  <div
                    className={`lane lane-${lane.id} ${laneAcceptsDrag(lane.id) ? 'lane-drop-available' : ''} ${dragOverLane === lane.id ? 'lane-drag-over' : ''}`}
                    key={lane.id}
                    onDragOver={(event) => {
                      if (!laneAcceptsDrag(lane.id)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setDragOverLane(lane.id);
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setDragOverLane((current) =>
                          current === lane.id ? null : current,
                        );
                    }}
                    onDrop={(event) => dropTask(event, lane.id)}
                  >
                    <div className="lane-head">
                      <div>
                        <p>{lane.eyebrow}</p>
                        <h2>{lane.title}</h2>
                      </div>
                      <span>{lanes[lane.id].length}</span>
                    </div>
                    <div className="lane-list">
                      {lanes[lane.id].map((todo) => (
                        <TaskCard
                          key={todo.id}
                          todo={todo}
                          types={data.types}
                          allTodos={visibleTodos}
                          onEdit={() => setEditing(todo)}
                          onToggle={() =>
                            mutate(() =>
                              todoApi.setTodoCompleted(
                                todo.id,
                                !todo.completedAt,
                              ),
                            )
                          }
                          onToggleChild={(child) =>
                            mutate(() =>
                              todoApi.setTodoCompleted(
                                child.id,
                                !child.completedAt,
                              ),
                            )
                          }
                          onAddChild={() => openCreate(todo.id)}
                          onEditChild={(child) => setEditing(child)}
                          showUntypedChildren={selectedType === 'all'}
                          draggable={
                            !todo.completedAt && isReschedulableLane(lane.id)
                          }
                          onDragStart={(event) => startTaskDrag(event, todo)}
                          onDragEnd={() => {
                            setDraggingTodoId(null);
                            setDragOverLane(null);
                          }}
                        />
                      ))}
                      {!lanes[lane.id].length && (
                        <div className="lane-empty">
                          <span className="lane-empty-icon">
                            <Icon name={lane.emptyIcon} />
                          </span>
                          <h3>{lane.emptyTitle}</h3>
                          <p>{lane.emptyCopy}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ) : (
              <TaskList
                todos={filtered}
                types={data.types}
                allTodos={visibleTodos}
                onEdit={setEditing}
                onToggle={(todo) =>
                  mutate(() =>
                    todoApi.setTodoCompleted(todo.id, !todo.completedAt),
                  )
                }
                onAddChild={(todo) => openCreate(todo.id)}
                showUntypedChildren={selectedType === 'all'}
              />
            )}
          </>
        )}
        {view === 'settings' && (
          <Settings
            data={data}
            busy={busy}
            error={error}
            onBack={() => setView('board')}
            mutate={mutate}
            initialTab={settingsTab}
            backup={backupStatus}
            onBackupChange={setBackupStatus}
            updateStatus={updateStatus}
            checkingUpdates={checkingUpdates}
            onCheckForUpdates={() => void checkForUpdates()}
            onOpenUpdateDownload={() => void openUpdateDownload()}
            requestConfirmation={requestConfirmation}
          />
        )}
      </main>

      {editing !== undefined && (
        <TaskModal
          key={
            editing ? `edit:${editing.id}` : `create:${quickParentId ?? 'root'}`
          }
          todo={editing}
          parentId={quickParentId}
          defaultTypeId={selectedType === 'all' ? undefined : selectedType}
          data={data}
          busy={busy}
          onClose={() => setEditing(undefined)}
          onSave={(draft, keepOpen) =>
            mutate(async () => {
              if (editing) await todoApi.updateTodo(editing.id, draft);
              else {
                await todoApi.createTodo(draft);
                if (selectedType !== 'all') {
                  const currentTypeName =
                    data.types.find((type) => type.id === selectedType)?.name ??
                    'this view';
                  const createdTypeName =
                    data.types.find((type) => type.id === draft.typeId)?.name ??
                    'Untyped';
                  setTaskCreatedToast({
                    id: Date.now(),
                    currentTypeName,
                    createdTypeName,
                    hiddenFromCurrentView: draft.typeId !== selectedType,
                  });
                }
              }
              if (!keepOpen) setEditing(undefined);
            })
          }
          onDelete={
            editing
              ? async () => {
                  const hasChildren = editing.children.length > 0;
                  if (hasChildren) {
                    const confirmed = await requestConfirmation({
                      title: `Delete “${editing.title}”?`,
                      message:
                        'This will also delete all of its child tasks. This cannot be undone.',
                      confirmLabel: 'Delete task',
                      danger: true,
                    });
                    if (!confirmed) return;
                  }
                  await mutate(async () => {
                    await todoApi.deleteTodo(editing.id);
                    setEditing(undefined);
                  });
                }
              : undefined
          }
          onQuickChild={
            editing && !editing.parentId
              ? () => {
                  const parent = editing.id;
                  setEditing(undefined);
                  openCreate(parent);
                }
              : undefined
          }
        />
      )}
      {onboardingStep && (
        <FirstRunTour
          step={onboardingStep}
          onBack={() =>
            setOnboardingStep((onboardingStep - 1) as OnboardingStep)
          }
          onNext={() =>
            setOnboardingStep((onboardingStep + 1) as OnboardingStep)
          }
          onFinish={() => void finishOnboarding()}
        />
      )}
      {confirmation && (
        <ConfirmationModal
          {...confirmation}
          onCancel={() => settleConfirmation(false)}
          onConfirm={() => settleConfirmation(true)}
        />
      )}
      {reschedule && (
        <RescheduleModal
          request={reschedule}
          onClose={() => setReschedule(null)}
          onConfirm={(dueDate) =>
            void mutate(async () => {
              await todoApi.rescheduleTodo(reschedule.todo.id, dueDate);
              setReschedule(null);
            })
          }
          busy={busy}
        />
      )}
      {taskCreatedToast && (
        <TaskCreatedToast
          key={taskCreatedToast.id}
          toast={taskCreatedToast}
          onDismiss={() => setTaskCreatedToast(null)}
        />
      )}
    </div>
  );
}

function TaskCreatedToast({
  toast,
  onDismiss,
}: {
  toast: TaskCreatedToastState;
  onDismiss: () => void;
}) {
  return (
    <div className="task-created-toast" role="status" aria-live="polite">
      <span className="task-created-toast-icon">
        <Icon name="check" />
      </span>
      <div>
        <strong>Task created successfully</strong>
        <p>
          {toast.hiddenFromCurrentView ? (
            <>
              <strong>Not visible in {toast.currentTypeName}.</strong> This task
              is assigned to {toast.createdTypeName}.
            </>
          ) : (
            <>It has been added to {toast.currentTypeName}.</>
          )}
        </p>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" />
      </button>
    </div>
  );
}

function FirstRunTour({
  step,
  onBack,
  onNext,
  onFinish,
}: {
  step: OnboardingStep;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
}) {
  const content = {
    1: {
      eyebrow: 'Welcome to LastTodo',
      title: 'Your tasks, on your terms',
      body: (
        <>
          <p>
            LastTodo stores every task locally on this computer, so your
            workspace stays private and available offline.
          </p>
          <div className="onboarding-storage-flow" aria-label="Backup flow">
            <span>💻 Local tasks</span>
            <b>→</b>
            <span>📁 Any folder</span>
            <b>→</b>
            <span>☁️ Sync it for cloud backup</span>
          </div>
          <p>
            Backups are optional, and <strong>any local folder works</strong>.
            If the folder you choose is already synced by Dropbox, Google Drive,
            OneDrive, or another service, your backup files ride along and you
            get cloud persistence without a LastTodo account or subscription.
          </p>
        </>
      ),
    },
    2: {
      eyebrow: 'Step 2 · Capture',
      title: 'Create your first task here',
      body: (
        <p>
          Use <strong>New task</strong> whenever something needs your attention.
          Add a due date, type, priority, people, links, or subtasks when they
          help.
        </p>
      ),
    },
    3: {
      eyebrow: 'Step 3 · See what is next',
      title: 'Dates organize the swim lanes',
      body: (
        <>
          <p>
            Tasks flow into Overdue, Today, Next 7 days, Next 30 days, and
            Future based on their due date. This view is opinionated by design:
            it asks you to make a real decision about urgency instead of leaving
            work in an unranked pile.
          </p>
          <p>
            Need to punt something or pull it forward? Drag a card by its edge
            between Today, Next 7 days, Next 30 days, and Future, then confirm
            the proposed new due date.
          </p>
        </>
      ),
    },
    4: {
      eyebrow: 'Step 4 · Make it yours',
      title: 'Types shape your workspace',
      body: (
        <>
          <p>
            Types are configurable categories in the left column. Edit their
            name and icon, create your own in Settings, or leave a task untyped
            when it does not need a category.
          </p>
          <p>
            <strong>Labels add context:</strong> enable quick filters for any
            label in Settings to keep its values handy above the task views
            where that label applies.
          </p>
        </>
      ),
    },
  }[step];

  return (
    <div className={`onboarding-layer onboarding-step-${step}`}>
      <div className="onboarding-scrim" />
      <section
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        tabIndex={-1}
        autoFocus
      >
        <div className="onboarding-progress" aria-label={`Step ${step} of 4`}>
          {[1, 2, 3, 4].map((value) => (
            <i key={value} className={value <= step ? 'active' : ''} />
          ))}
        </div>
        <p className="eyebrow">{content.eyebrow}</p>
        <h2 id="onboarding-title">{content.title}</h2>
        <div className="onboarding-copy">{content.body}</div>
        <footer>
          <button className="onboarding-skip" onClick={onFinish}>
            Skip tour
          </button>
          <div>
            {step > 1 && (
              <button className="secondary" onClick={onBack}>
                Back
              </button>
            )}
            <button
              className="primary"
              onClick={step === 4 ? onFinish : onNext}
            >
              {step === 4 ? 'Start using LastTodo' : 'Next'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function BackupDisabledBanner({
  onDismiss,
  onOpenSettings,
}: {
  onDismiss: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="backup-disabled-banner" role="status">
      <span className="backup-disabled-icon">!</span>
      <div>
        <strong>Backups are disabled</strong>
        <p>Select a folder to protect your local tasks with snapshots.</p>
      </div>
      <button className="backup-settings-link" onClick={onOpenSettings}>
        Open backup settings
      </button>
      <button
        className="icon-button"
        onClick={onDismiss}
        aria-label="Dismiss backup warning"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

function UpdateAvailableBanner({
  version,
  downloadLabel,
  onDownload,
  onDismiss,
}: {
  version: string;
  downloadLabel: string;
  onDownload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="update-available-banner" role="status">
      <span className="update-available-icon">
        <Icon name="sparkle" />
      </span>
      <div>
        <strong>LastTodo {version} is available</strong>
        <p>
          Download the new {downloadLabel} from GitHub and install it when
          you’re ready.
        </p>
      </div>
      <button className="update-download-link" onClick={onDownload}>
        Download update
      </button>
      <button
        className="icon-button"
        onClick={onDismiss}
        aria-label="Dismiss update notification"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

function QuickFilterPanel({
  labels,
  selected,
  onChange,
}: {
  labels: LabelDefinition[];
  selected: Record<string, string>;
  onChange: (labelId: string, valueId: string | null) => void;
}) {
  return (
    <section className="quick-filter-panel" aria-label="Quick filters">
      {labels.map((label) => {
        const selectedValue = selected[label.id] ?? null;
        return (
          <div className="quick-filter-group" key={label.id}>
            <div className="quick-filter-heading">
              <strong>{label.name}</strong>
              <small>Quick filter</small>
            </div>
            <div
              className="quick-filter-options"
              role="radiogroup"
              aria-label={`Filter by ${label.name}`}
            >
              <button
                className={selectedValue === null ? 'active' : ''}
                role="radio"
                aria-checked={selectedValue === null}
                onClick={() => onChange(label.id, null)}
              >
                All
              </button>
              {label.values.map((value) => (
                <button
                  className={selectedValue === value.id ? 'active' : ''}
                  key={value.id}
                  role="radio"
                  aria-checked={selectedValue === value.id}
                  onClick={() => onChange(label.id, value.id)}
                >
                  {value.value}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function FilterBar({
  types,
  selectedType,
  onTypeChange,
  due,
  onDueChange,
  showDueFilter,
  priorityFilter,
  onPriorityChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  hasActiveFilters,
  onReset,
}: {
  types: TodoType[];
  selectedType: string;
  onTypeChange: (value: string) => void;
  due: DueFilter;
  onDueChange: (value: DueFilter) => void;
  showDueFilter: boolean;
  priorityFilter: PriorityFilter;
  onPriorityChange: (value: PriorityFilter) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  sort: SortMode;
  onSortChange: (value: SortMode) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
}) {
  return (
    <section className="filter-bar" id="task-filters" aria-label="Task filters">
      {types.length > 0 && (
        <label className="filter-select">
          <span>Type</span>
          <select
            aria-label="Filter by type"
            value={selectedType}
            onChange={(event) => onTypeChange(event.target.value)}
          >
            <option value="all">All types</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.emoji} {type.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {showDueFilter && (
        <label className="filter-select">
          <span>Due</span>
          <select
            aria-label="Filter by due date"
            value={due}
            onChange={(event) => onDueChange(event.target.value as DueFilter)}
          >
            <option value="any">Any date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="month">Next 30 days</option>
            <option value="future">Future</option>
          </select>
        </label>
      )}
      <label className="filter-select">
        <span>Priority</span>
        <select
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(event) =>
            onPriorityChange(event.target.value as PriorityFilter)
          }
        >
          <option value="any">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="none">No priority</option>
        </select>
      </label>
      <div className="status-filter-group">
        <span className="filter-label">Status</span>
        <div className="status-filter" role="radiogroup" aria-label="Status">
          {(
            [
              ['active', 'Active'],
              ['all', 'All'],
              ['completed', 'Done'],
            ] as Array<[StatusFilter, string]>
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="status-filter"
                value={value}
                checked={status === value}
                onChange={() => onStatusChange(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="filter-select sort-filter">
        <span>Sort</span>
        <select
          aria-label="Sort tasks"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortMode)}
        >
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
          <option value="created">Newest</option>
          <option value="title">Title</option>
        </select>
      </label>
      <button
        className="clear-filters"
        onClick={onReset}
        disabled={!hasActiveFilters}
      >
        Clear filters
      </button>
    </section>
  );
}

function ErrorBanner({
  message,
  retry,
}: {
  message: string;
  retry: () => Promise<void>;
}) {
  return (
    <div className="error-banner" role="alert">
      <span>!</span>
      <p>{message}</p>
      <button onClick={() => void retry()}>Try again</button>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <section className="board skeleton-board" aria-label="Loading tasks">
      {LANES.map((lane) => (
        <div className="lane" key={lane.id}>
          <div className="skeleton wide" />
          <div className="skeleton card-skeleton" />
          <div className="skeleton card-skeleton short" />
        </div>
      ))}
    </section>
  );
}

function CompletionBurst() {
  return (
    <span className="completion-burst" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function TaskList({
  todos,
  types,
  allTodos,
  onEdit,
  onToggle,
  onAddChild,
  showUntypedChildren,
}: {
  todos: Todo[];
  types: TodoType[];
  allTodos: Todo[];
  onEdit: (todo: Todo) => void;
  onToggle: (todo: Todo) => Promise<void>;
  onAddChild: (todo: Todo) => void;
  showUntypedChildren: boolean;
}) {
  return (
    <section className="task-list" aria-label="Tasks as a list">
      <div className="task-list-table">
        <div className="task-list-head" aria-hidden="true">
          <span>Task</span>
          <span>Type</span>
          <span>Labels</span>
          <span>Due</span>
          <span>Progress</span>
          <span />
        </div>
        {todos.map((todo) => (
          <ListTaskGroup
            key={todo.id}
            todo={todo}
            types={types}
            allTodos={allTodos}
            onEdit={onEdit}
            onToggle={onToggle}
            onAddChild={onAddChild}
            showUntypedChildren={showUntypedChildren}
          />
        ))}
        {!todos.length && (
          <div className="list-empty">
            <span>✦</span>
            <strong>No matching tasks</strong>
            <p>Try clearing a filter or capture something new.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ListTaskGroup({
  todo,
  types,
  allTodos,
  onEdit,
  onToggle,
  onAddChild,
  showUntypedChildren,
}: {
  todo: Todo;
  types: TodoType[];
  allTodos: Todo[];
  onEdit: (todo: Todo) => void;
  onToggle: (todo: Todo) => Promise<void>;
  onAddChild: (todo: Todo) => void;
  showUntypedChildren: boolean;
}) {
  const [completing, setCompleting] = useState(false);
  const completeChildren = todo.children.filter(
    (child) => child.completedAt,
  ).length;
  const canComplete =
    !todo.children.length || completeChildren === todo.children.length;
  const type = types.find((candidate) => candidate.id === todo.typeId);
  const dueDate = effectiveDate(todo, allTodos);
  const dueLane = laneFor(todo, allTodos);
  const displayedChildren = showUntypedChildren
    ? todo.children
    : todo.children.filter((child) => child.typeId !== null);

  const toggleParent = async () => {
    if (todo.completedAt) {
      await onToggle(todo);
      return;
    }
    setCompleting(true);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 80
      : 700;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    await onToggle(todo);
    setCompleting(false);
  };

  const openWithKeyboard = (
    event: React.KeyboardEvent<HTMLDivElement>,
    target: Todo,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onEdit(target);
    }
  };

  return (
    <article
      className={`task-list-group ${todo.completedAt ? 'completed' : ''} ${completing ? 'completing' : ''}`}
    >
      <div
        className="task-list-row parent-row"
        role="button"
        tabIndex={0}
        onClick={() => onEdit(todo)}
        onKeyDown={(event) => openWithKeyboard(event, todo)}
      >
        <div className="list-task-cell">
          <button
            className="completion"
            aria-label={
              todo.completedAt
                ? 'Mark incomplete'
                : canComplete
                  ? 'Mark complete'
                  : 'Complete child tasks first'
            }
            disabled={!canComplete || completing}
            onClick={(event) => {
              event.stopPropagation();
              void toggleParent();
            }}
          >
            {(todo.completedAt || completing) && <Icon name="check" />}
            {completing && <CompletionBurst />}
          </button>
          <div>
            <span className="list-title-line">
              <strong>{todo.title}</strong>
              {todo.sensitive && (
                <span className="sensitive-badge" title="Sensitive task">
                  <Icon name="lock" />
                </span>
              )}
            </span>
            {todo.description && <small>{todo.description}</small>}
          </div>
        </div>
        <span className="list-type">
          {type ? `${type.emoji} ${type.name}` : 'Untyped'}
        </span>
        <div className="list-labels">
          {todo.labels.slice(0, 2).map((label) => (
            <span
              className={`chip ${label.labelName.toLowerCase() === 'priority' ? `priority-${label.value.toLowerCase()}` : ''}`}
              key={`${label.labelId}:${label.labelValueId}`}
            >
              {label.value}
            </span>
          ))}
          {todo.labels.length > 2 && (
            <span className="chip">+{todo.labels.length - 2}</span>
          )}
        </div>
        <time
          className={dueLane === 'overdue' ? 'overdue-date' : ''}
          dateTime={dueDate ?? undefined}
        >
          {niceDate(dueDate)}
        </time>
        <span className="list-progress">
          {todo.children.length
            ? `${completeChildren}/${todo.children.length}`
            : '—'}
        </span>
        <div className="list-row-actions">
          <button
            className="add-list-child"
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(todo);
            }}
          >
            <Icon name="plus" />
            Child
          </button>
          <button
            className="icon-button"
            aria-label={`Edit ${todo.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(todo);
            }}
          >
            <Icon name="more" />
          </button>
        </div>
      </div>
      {displayedChildren.map((child) => {
        const childType = types.find(
          (candidate) => candidate.id === child.typeId,
        );
        return (
          <div
            className={`task-list-row child-list-row ${child.completedAt ? 'completed' : ''}`}
            role="button"
            tabIndex={0}
            key={child.id}
            onClick={() => onEdit(child)}
            onKeyDown={(event) => openWithKeyboard(event, child)}
          >
            <div className="list-task-cell">
              <span className="child-branch" aria-hidden="true" />
              <button
                className={`child-completion ${child.completedAt ? 'done' : ''}`}
                aria-label={
                  child.completedAt
                    ? `Mark ${child.title} incomplete`
                    : `Complete ${child.title}`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  void onToggle(child);
                }}
              >
                {child.completedAt && <Icon name="check" />}
              </button>
              <div>
                <span className="list-title-line">
                  <strong>{child.title}</strong>
                  {child.sensitive && (
                    <span className="sensitive-badge" title="Sensitive task">
                      <Icon name="lock" />
                    </span>
                  )}
                </span>
                <small>Child task</small>
              </div>
            </div>
            <span className="list-type">
              {childType ? `${childType.emoji} ${childType.name}` : 'Untyped'}
            </span>
            <div className="list-labels">
              {child.labels.slice(0, 2).map((label) => (
                <span className="chip" key={label.labelValueId}>
                  {label.value}
                </span>
              ))}
            </div>
            <time dateTime={effectiveDate(child, allTodos) ?? undefined}>
              {niceDate(effectiveDate(child, allTodos))}
            </time>
            <span className="list-progress">Child</span>
            <button
              className="icon-button list-child-edit"
              aria-label={`Edit ${child.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit(child);
              }}
            >
              <Icon name="chevron" />
            </button>
          </div>
        );
      })}
    </article>
  );
}

function TaskCard({
  todo,
  types,
  allTodos,
  onEdit,
  onToggle,
  onToggleChild,
  onAddChild,
  onEditChild,
  draggable,
  onDragStart,
  onDragEnd,
  showUntypedChildren,
}: {
  todo: Todo;
  types: TodoType[];
  allTodos: Todo[];
  onEdit: () => void;
  onToggle: () => Promise<void>;
  onToggleChild: (child: Todo) => Promise<void>;
  onAddChild: () => void;
  onEditChild: (child: Todo) => void;
  draggable: boolean;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  showUntypedChildren: boolean;
}) {
  const [completing, setCompleting] = useState(false);
  const completeChildren = todo.children.filter(
    (child) => child.completedAt,
  ).length;
  const canComplete =
    !todo.children.length || completeChildren === todo.children.length;
  const type = types.find((candidate) => candidate.id === todo.typeId);
  const cardLabels = todo.labels;
  const dueLane = laneFor(todo, allTodos);
  const priorityLevel = priorityName(todo);
  const displayedChildren = showUntypedChildren
    ? todo.children
    : todo.children.filter((child) => child.typeId !== null);
  const toggle = async () => {
    if (todo.completedAt) {
      await onToggle();
      return;
    }
    setCompleting(true);
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 80
      : 700;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    await onToggle();
    setCompleting(false);
  };
  return (
    <article
      className={`task-card priority-card-${priorityLevel} ${todo.completedAt ? 'completed' : ''} ${completing ? 'completing' : ''}`}
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEdit();
      }}
    >
      {draggable &&
        ['top', 'right', 'bottom', 'left'].map((edge) => (
          <span
            className={`task-drag-edge task-drag-edge-${edge}`}
            draggable
            aria-hidden="true"
            key={edge}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      <div className="card-top">
        <button
          className="completion"
          aria-label={
            todo.completedAt
              ? 'Mark incomplete'
              : canComplete
                ? 'Mark complete'
                : 'Complete child tasks first'
          }
          disabled={!canComplete || completing}
          onClick={(event) => {
            event.stopPropagation();
            void toggle();
          }}
        >
          {(todo.completedAt || completing) && <Icon name="check" />}
          {completing && <CompletionBurst />}
        </button>
        <div className="card-title">
          <span className="type-name">
            {type?.emoji && <b className="task-type-emoji">{type.emoji}</b>}
            {type?.name ?? 'Untyped'}
            {todo.sensitive && (
              <span className="sensitive-badge" title="Sensitive task">
                <Icon name="lock" />
              </span>
            )}
          </span>
          <h3>{todo.title}</h3>
        </div>
        <button
          className="icon-button"
          aria-label="Task actions"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <Icon name="more" />
        </button>
      </div>
      {cardLabels.length > 0 && (
        <div className="chips">
          {cardLabels.slice(0, 4).map((label) => (
            <span
              className={`chip ${label.labelName.toLowerCase() === 'priority' ? `priority-${label.value.toLowerCase()}` : ''}`}
              key={`${label.labelId}:${label.labelValueId}`}
            >
              {label.value}
            </span>
          ))}
          {cardLabels.length > 4 && (
            <span className="chip">+{cardLabels.length - 4}</span>
          )}
        </div>
      )}
      <div className="card-meta">
        <time
          className={`date-pill date-${dueLane}`}
          dateTime={effectiveDate(todo, allTodos) ?? undefined}
        >
          {niceDate(effectiveDate(todo, allTodos))}
        </time>
        {todo.links.length > 0 && (
          <span>
            <Icon name="link" />
            {todo.links.length}
          </span>
        )}
        {todo.children.length > 0 && (
          <span className="progress">
            <i
              style={{
                width: `${(completeChildren / todo.children.length) * 100}%`,
              }}
            />
            {completeChildren}/{todo.children.length}
          </span>
        )}
      </div>
      {displayedChildren.length > 0 && (
        <div className="children-preview">
          {displayedChildren.map((child) => (
            <div className="child-row" key={child.id}>
              <button
                type="button"
                className={`child-completion ${child.completedAt ? 'done' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void onToggleChild(child);
                }}
                aria-label={
                  child.completedAt
                    ? `Mark ${child.title} incomplete`
                    : `Complete ${child.title}`
                }
              >
                {child.completedAt && <Icon name="check" />}
              </button>
              <button
                type="button"
                className="child-open"
                onClick={(event) => {
                  event.stopPropagation();
                  onEditChild(child);
                }}
                aria-label={`Edit child task ${child.title}`}
              >
                <p className={child.completedAt ? 'done' : ''}>{child.title}</p>
                <Icon name="chevron" />
              </button>
            </div>
          ))}
        </div>
      )}
      {!todo.parentId && (
        <button
          className="quick-child"
          onClick={(event) => {
            event.stopPropagation();
            onAddChild();
          }}
        >
          <Icon name="plus" />
          Add child
        </button>
      )}
    </article>
  );
}

function TaskModal({
  todo,
  parentId,
  defaultTypeId,
  data,
  busy,
  onClose,
  onSave,
  onDelete,
  onQuickChild,
}: {
  todo: Todo | null;
  parentId: string | null;
  defaultTypeId?: string;
  data: AppData;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TodoDraft, keepOpen: boolean) => void | Promise<void>;
  onDelete?: () => void;
  onQuickChild?: () => void;
}) {
  const initial = todo
    ? {
        title: todo.title,
        typeId: todo.typeId,
        dueDate: todo.dueDate,
        description: todo.description ?? '',
        parentId: todo.parentId,
        sensitive: todo.sensitive,
        labelValueIds: todo.labels.map((label) => label.labelValueId),
        links: todo.links.map((link) => ({ label: link.label, url: link.url })),
      }
    : {
        ...EMPTY_DRAFT,
        typeId: defaultTypeId ?? data.types[0]?.id ?? null,
        parentId,
      };
  const [draft, setDraft] = useState<TodoDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const isChild = Boolean(draft.parentId);
  const availableLabels = data.labels.filter(
    (label) =>
      label.values.length > 0 &&
      (label.scope === 'universal' ||
        (draft.typeId !== null && label.gatedTypeIds.includes(draft.typeId))),
  );
  const valid = Boolean(draft.title.trim() && (draft.dueDate || isChild));
  const selectedParent = data.todos.find(
    (candidate) => candidate.id === draft.parentId,
  );
  const parentCandidates = data.todos
    .filter(
      (candidate) =>
        !candidate.parentId &&
        candidate.id !== todo?.id &&
        !candidate.completedAt,
    )
    .filter((candidate) => {
      const query = parentQuery.trim().toLowerCase();
      if (!query) return true;
      const type = data.types.find((item) => item.id === candidate.typeId);
      return [
        candidate.title,
        type?.name ?? 'Untyped',
        ...candidate.labels.map((label) => label.value),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  const save = (keepOpen: boolean) => {
    setAttempted(true);
    if (valid) {
      void onSave(
        {
          ...draft,
          title: draft.title.trim(),
          links: draft.links.filter((link) => link.url.trim()),
        },
        keepOpen,
      );
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save(false);
  };
  const setLabel = (
    label: LabelDefinition,
    valueId: string,
    checked: boolean,
  ) =>
    setDraft((current) => {
      const ids = current.labelValueIds.filter(
        (id) => !label.values.some((value) => value.id === id),
      );
      if (label.cardinality === 'single')
        return { ...current, labelValueIds: valueId ? [...ids, valueId] : ids };
      return {
        ...current,
        labelValueIds: checked
          ? [...current.labelValueIds, valueId]
          : current.labelValueIds.filter((id) => id !== valueId),
      };
    });

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
      >
        <header>
          {parentPickerOpen ? (
            <div className="parent-picker-heading">
              <button
                type="button"
                className="parent-picker-back"
                onClick={() => setParentPickerOpen(false)}
              >
                <Icon name="chevron" />
                Back
              </button>
              <div>
                <p className="eyebrow">Parent task</p>
                <h2 id="task-modal-title">Assign a parent</h2>
              </div>
            </div>
          ) : (
            <div>
              <p className="eyebrow">
                {todo
                  ? 'Task details'
                  : isChild
                    ? 'New child task'
                    : 'New task'}
              </p>
              <h2 id="task-modal-title">
                {todo ? 'Edit task' : 'Capture something'}
              </h2>
            </div>
          )}
          <button
            className="icon-button large"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </header>
        {parentPickerOpen ? (
          <div className="parent-picker-view">
            <label className="parent-picker-search">
              <Icon name="search" />
              <input
                autoFocus
                value={parentQuery}
                onChange={(event) => setParentQuery(event.currentTarget.value)}
                placeholder="Search by task, type, or label…"
                aria-label="Search possible parent tasks"
              />
            </label>
            {draft.parentId && (
              <button
                type="button"
                className="parent-picker-clear"
                onClick={() => {
                  setDraft((current) => ({ ...current, parentId: null }));
                  setParentPickerOpen(false);
                }}
              >
                <Icon name="x" />
                Remove parent assignment
              </button>
            )}
            <div
              className="parent-picker-list"
              role="listbox"
              aria-label="Possible parent tasks"
            >
              {parentCandidates.map((candidate) => {
                const type = data.types.find(
                  (item) => item.id === candidate.typeId,
                );
                const selected = candidate.id === draft.parentId;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`parent-picker-row ${selected ? 'selected' : ''}`}
                    key={candidate.id}
                    onClick={() => {
                      setDraft((current) => ({
                        ...current,
                        parentId: candidate.id,
                      }));
                      setParentPickerOpen(false);
                    }}
                  >
                    <span className="parent-picker-row-copy">
                      <strong>{candidate.title}</strong>
                      <small>
                        {type ? `${type.emoji} ${type.name}` : 'Untyped'}
                      </small>
                    </span>
                    <span className="parent-picker-row-labels">
                      {candidate.labels.slice(0, 3).map((label) => (
                        <span className="chip" key={label.labelValueId}>
                          {label.value}
                        </span>
                      ))}
                      {candidate.labels.length > 3 && (
                        <span className="chip">
                          +{candidate.labels.length - 3}
                        </span>
                      )}
                    </span>
                    <span className="parent-picker-select-indicator">
                      {selected ? <Icon name="check" /> : 'Select'}
                    </span>
                  </button>
                );
              })}
              {parentCandidates.length === 0 && (
                <div className="parent-picker-empty">
                  <Icon name="search" />
                  <strong>No tasks found</strong>
                  <small>
                    {parentQuery.trim()
                      ? 'Try a different search.'
                      : 'Create another top-level task first.'}
                  </small>
                </div>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="form-scroll">
              <label className="field title-field">
                <span>
                  Title <b>*</b>
                </span>
                <input
                  autoFocus
                  value={draft.title}
                  onChange={(event) => {
                    const title = event.currentTarget.value;
                    setDraft((current) => ({ ...current, title }));
                  }}
                  placeholder="What needs to happen?"
                  className={attempted && !draft.title.trim() ? 'invalid' : ''}
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>Type</span>
                  <select
                    value={draft.typeId ?? ''}
                    onChange={(event) => {
                      const typeId = event.currentTarget.value || null;
                      setDraft((current) => ({
                        ...current,
                        typeId,
                        labelValueIds: [],
                      }));
                    }}
                  >
                    <option value="">No type</option>
                    {data.types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.emoji} {type.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Due date {!isChild && <b>*</b>}</span>
                  <input
                    type="date"
                    value={draft.dueDate ?? ''}
                    onChange={(event) => {
                      const dueDate = event.currentTarget.value || null;
                      setDraft((current) => ({ ...current, dueDate }));
                    }}
                    className={
                      attempted && !draft.dueDate && !isChild ? 'invalid' : ''
                    }
                  />
                  <small>
                    {isChild && !draft.dueDate
                      ? 'Inherits its parent’s date'
                      : 'Your local time'}
                  </small>
                </label>
              </div>
              <div className="field parent-task-field">
                <span>Parent task</span>
                <div className="parent-picker-control">
                  <button
                    type="button"
                    className="parent-picker-trigger"
                    disabled={Boolean(todo?.children.length)}
                    onClick={() => {
                      setParentQuery('');
                      setParentPickerOpen(true);
                    }}
                  >
                    <span>
                      <strong>
                        {selectedParent?.title ?? 'Assign parent'}
                      </strong>
                      <small>
                        {selectedParent
                          ? 'This task will inherit its parent’s date when no date is set.'
                          : 'Make this a subtask of another task.'}
                      </small>
                    </span>
                  </button>
                  <div className="parent-picker-control-actions">
                    {selectedParent && (
                      <button
                        type="button"
                        className="parent-picker-remove-inline"
                        disabled={Boolean(todo?.children.length)}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            parentId: null,
                          }))
                        }
                      >
                        <Icon name="x" />
                        Remove
                      </button>
                    )}
                    <button
                      type="button"
                      className="parent-picker-trigger-action"
                      disabled={Boolean(todo?.children.length)}
                      onClick={() => {
                        setParentQuery('');
                        setParentPickerOpen(true);
                      }}
                    >
                      {selectedParent ? 'Change' : 'Choose'}
                      <Icon name="chevron" />
                    </button>
                  </div>
                </div>
                {Boolean(todo?.children.length) && (
                  <small>
                    A task with children cannot be assigned to another parent.
                  </small>
                )}
              </div>
              <label className="sensitive-field">
                <input
                  type="checkbox"
                  checked={draft.sensitive}
                  onChange={(event) => {
                    const sensitive = event.currentTarget.checked;
                    setDraft((current) => ({ ...current, sensitive }));
                  }}
                />
                <span className="sensitive-checkbox">
                  {draft.sensitive && <Icon name="check" />}
                </span>
                <span className="sensitive-field-icon">
                  <Icon name="lock" />
                </span>
                <span>
                  <strong>Sensitive</strong>
                  <small>
                    Hide this task unless “Show sensitive” is enabled.
                  </small>
                </span>
              </label>
              {availableLabels.length > 0 && (
                <div className="label-fields">
                  <div className="section-label">Labels</div>
                  {availableLabels.map((label) => (
                    <div className="label-control" key={label.id}>
                      <div>
                        <strong>{label.name}</strong>
                        <small>
                          {label.cardinality === 'multi'
                            ? 'Choose any'
                            : 'Choose one'}
                        </small>
                      </div>
                      {label.cardinality === 'single' ? (
                        <select
                          value={
                            label.values.find((value) =>
                              draft.labelValueIds.includes(value.id),
                            )?.id ?? ''
                          }
                          onChange={(event) =>
                            setLabel(label, event.target.value, true)
                          }
                        >
                          <option value="">None</option>
                          {label.values.map((value) => (
                            <option key={value.id} value={value.id}>
                              {value.value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="check-chips">
                          {label.values.map((value) => (
                            <label key={value.id}>
                              <input
                                type="checkbox"
                                checked={draft.labelValueIds.includes(value.id)}
                                onChange={(event) =>
                                  setLabel(
                                    label,
                                    value.id,
                                    event.target.checked,
                                  )
                                }
                              />
                              <span>{value.value}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <label className="field">
                <span>Description</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => {
                    const description = event.currentTarget.value;
                    setDraft((current) => ({ ...current, description }));
                  }}
                  placeholder="Add context, notes, or the desired outcome…"
                  rows={4}
                />
              </label>
              <div className="links-editor">
                <div className="section-label">
                  <span>Links</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        links: [...current.links, { label: '', url: '' }],
                      }))
                    }
                  >
                    <Icon name="plus" />
                    Add link
                  </button>
                </div>
                {draft.links.map((link, index) => (
                  <div className="link-row" key={index}>
                    <input
                      aria-label={`Link ${index + 1} label`}
                      value={link.label}
                      placeholder="Label (optional)"
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          links: current.links.map((item, linkIndex) =>
                            linkIndex === index ? { ...item, label } : item,
                          ),
                        }));
                      }}
                    />
                    <input
                      aria-label={`Link ${index + 1} URL`}
                      type="url"
                      required
                      value={link.url}
                      placeholder="https://…"
                      onChange={(event) => {
                        const url = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          links: current.links.map((item, linkIndex) =>
                            linkIndex === index ? { ...item, url } : item,
                          ),
                        }));
                      }}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove link"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          links: current.links.filter(
                            (_, linkIndex) => linkIndex !== index,
                          ),
                        }))
                      }
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <footer>
              <div className="modal-actions-left">
                {onDelete && (
                  <button
                    type="button"
                    className="danger-text"
                    onClick={onDelete}
                  >
                    Delete
                  </button>
                )}
                {onQuickChild && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={onQuickChild}
                  >
                    <Icon name="plus" />
                    Child
                  </button>
                )}
              </div>
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              {!todo && (
                <button
                  type="button"
                  className="secondary create-another"
                  disabled={busy || !valid}
                  onClick={(event) => {
                    if (event.currentTarget.form?.reportValidity()) save(true);
                  }}
                >
                  Create & add another
                </button>
              )}
              <button
                className="primary"
                value="save"
                disabled={busy || !valid}
              >
                {busy ? 'Saving…' : todo ? 'Save changes' : 'Create task'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

function ConfirmationModal({
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmationOptions & {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-backdrop confirmation-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="modal confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
      >
        <header>
          <div>
            <p className="eyebrow">Please confirm</p>
            <h2 id="confirmation-title">{title}</h2>
          </div>
        </header>
        <div className="confirmation-copy">{message}</div>
        <footer>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'primary danger-confirm' : 'primary'}
            autoFocus
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RescheduleModal({
  request,
  busy,
  onClose,
  onConfirm,
}: {
  request: RescheduleState;
  busy: boolean;
  onClose: () => void;
  onConfirm: (dueDate: string) => void;
}) {
  const [dueDate, setDueDate] = useState(request.proposedDate);
  const today = localISO(new Date());
  const range = dueDateRange(request.targetLane, today);
  const valid = isDueDateInLane(dueDate, request.targetLane, today);
  const laneTitle =
    LANES.find((lane) => lane.id === request.targetLane)?.title ?? 'new lane';

  return (
    <div
      className="modal-backdrop reschedule-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal reschedule-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-title"
      >
        <header>
          <div>
            <p className="eyebrow">Move to {laneTitle}</p>
            <h2 id="reschedule-title">Change this task’s due date?</h2>
          </div>
          <button
            className="icon-button large"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !busy) onConfirm(dueDate);
          }}
        >
          <div className="reschedule-copy">
            <p>
              Moving <strong>“{request.todo.title}”</strong> into {laneTitle}{' '}
              updates its due date. We’ve proposed{' '}
              {request.targetLane === 'future'
                ? 'the earliest date in that lane.'
                : 'the end of that scheduling window.'}
            </p>
            <label className="field">
              <span>Proposed new due date</span>
              <input
                type="date"
                value={dueDate}
                min={range.min}
                max={range.max}
                autoFocus
                onChange={(event) => setDueDate(event.currentTarget.value)}
              />
              <small>
                {range.max
                  ? `Choose a date from ${niceDate(range.min)} through ${niceDate(range.max)} to keep it in this lane.`
                  : `Choose ${niceDate(range.min)} or any later date to keep it in this lane.`}
              </small>
            </label>
          </div>
          <footer>
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="primary" disabled={!valid || busy}>
              {busy ? 'Moving…' : `Move to ${laneTitle}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function FieldHelp({ text }: { text: string }) {
  return (
    <span className="field-help" tabIndex={0} aria-label={text}>
      ?
      <span className="field-help-tooltip" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}

function TaskTypeMultiSelect({
  types,
  selected,
  onChange,
}: {
  types: TodoType[];
  selected: string[];
  onChange: (typeIds: string[]) => void;
}) {
  const selectedNames = types
    .filter((type) => selected.includes(type.id))
    .map((type) => `${type.emoji} ${type.name}`);
  return (
    <details className="type-multi-select">
      <summary>
        <span>
          {selectedNames.length > 0
            ? selectedNames.join(', ')
            : 'Choose task types…'}
        </span>
        <Icon name="chevron" />
      </summary>
      <div className="type-multi-select-menu">
        {types.map((type) => {
          const checked = selected.includes(type.id);
          return (
            <label key={type.id}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) =>
                  onChange(
                    event.currentTarget.checked
                      ? [...selected, type.id]
                      : selected.filter((typeId) => typeId !== type.id),
                  )
                }
              />
              <span className="type-multi-check">
                {checked && <Icon name="check" />}
              </span>
              <span aria-hidden="true">{type.emoji}</span>
              <strong>{type.name}</strong>
            </label>
          );
        })}
      </div>
    </details>
  );
}

function Settings({
  data,
  busy,
  error,
  onBack,
  mutate,
  initialTab,
  backup,
  onBackupChange,
  updateStatus,
  checkingUpdates,
  onCheckForUpdates,
  onOpenUpdateDownload,
  requestConfirmation,
}: {
  data: AppData;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  mutate: (action: () => Promise<unknown>) => Promise<void>;
  initialTab: SettingsTab;
  backup: BackupStatus | null;
  onBackupChange: (status: BackupStatus) => void;
  updateStatus: UpdateStatus | null;
  checkingUpdates: boolean;
  onCheckForUpdates: () => void;
  onOpenUpdateDownload: () => void;
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [newType, setNewType] = useState('');
  const [newTypeEmoji, setNewTypeEmoji] = useState<string>(DEFAULT_TYPE_EMOJI);
  const [typeEdit, setTypeEdit] = useState<{
    id: string;
    name: string;
    emoji: string;
  } | null>(null);
  const [labelEdit, setLabelEdit] = useState<{
    id: string;
    name: string;
    scope: 'universal' | 'type';
    gatedTypeIds: string[];
  } | null>(null);
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [renameTarget, setRenameTarget] = useState<{
    label: string;
    initial: string;
    action: (name: string) => Promise<void>;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [ftueComplete, setFtueComplete] = useState<boolean | null>(null);
  const [labelForm, setLabelForm] = useState<{
    name: string;
    scope: 'universal' | 'type';
    gatedTypeIds: string[];
    cardinality: 'single' | 'multi';
    quickFilter: boolean;
  }>({
    name: '',
    scope: 'universal',
    gatedTypeIds: [],
    cardinality: 'single',
    quickFilter: false,
  });
  const addType = (event: FormEvent) => {
    event.preventDefault();
    if (!newType.trim()) return;
    void mutate(async () => {
      await todoApi.createType({
        name: newType.trim(),
        emoji: newTypeEmoji,
      });
      setNewType('');
      setNewTypeEmoji(DEFAULT_TYPE_EMOJI);
    });
  };
  const submitTypeEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!typeEdit?.name.trim()) return;
    void mutate(async () => {
      await todoApi.updateType(typeEdit.id, {
        name: typeEdit.name.trim(),
        emoji: typeEdit.emoji,
      });
      setTypeEdit(null);
    });
  };
  const submitLabelEdit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !labelEdit?.name.trim() ||
      (labelEdit.scope === 'type' && labelEdit.gatedTypeIds.length === 0)
    )
      return;
    void mutate(async () => {
      await todoApi.updateLabel(labelEdit.id, {
        name: labelEdit.name.trim(),
        scope: labelEdit.scope,
        gatedTypeIds: labelEdit.scope === 'type' ? labelEdit.gatedTypeIds : [],
      });
      setLabelEdit(null);
    });
  };
  const addLabel = (event: FormEvent) => {
    event.preventDefault();
    if (!labelForm.name.trim()) return;
    void mutate(async () => {
      await todoApi.createLabel({
        ...labelForm,
        name: labelForm.name.trim(),
        gatedTypeIds: labelForm.scope === 'type' ? labelForm.gatedTypeIds : [],
      });
      setLabelForm({
        name: '',
        scope: 'universal',
        gatedTypeIds: [],
        cardinality: 'single',
        quickFilter: false,
      });
    });
  };
  const startRename = (
    label: string,
    initial: string,
    action: (name: string) => Promise<void>,
  ) => {
    setRenameTarget({ label, initial, action });
    setRenameValue(initial);
  };
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const name = renameValue.trim();
    if (!renameTarget || !name) return;
    if (name === renameTarget.initial) {
      setRenameTarget(null);
      return;
    }
    void mutate(async () => {
      await renameTarget.action(name);
      setRenameTarget(null);
    });
  };
  useEffect(() => {
    todoApi
      .getOnboardingStatus()
      .then(({ complete }) => setFtueComplete(complete))
      .catch(() => setFtueComplete(null));
  }, []);
  useEffect(() => {
    if (data.types.length > 0) return;
    setLabelForm((current) =>
      current.scope === 'universal' && current.gatedTypeIds.length === 0
        ? current
        : { ...current, scope: 'universal', gatedTypeIds: [] },
    );
    setLabelEdit((current) =>
      !current ||
      (current.scope === 'universal' && current.gatedTypeIds.length === 0)
        ? current
        : { ...current, scope: 'universal', gatedTypeIds: [] },
    );
  }, [data.types.length]);
  const setFtueState = (complete: boolean) => {
    void mutate(async () => {
      await todoApi.setOnboardingComplete(complete);
      setFtueComplete(complete);
    });
  };
  const typeEmojiOptions: ReadonlyArray<readonly [string, string]> =
    typeEdit && !TYPE_EMOJI_OPTIONS.some(([emoji]) => emoji === typeEdit.emoji)
      ? [[typeEdit.emoji, 'Current icon'], ...TYPE_EMOJI_OPTIONS]
      : TYPE_EMOJI_OPTIONS;
  return (
    <section className="settings-page">
      <header className="settings-head">
        <button className="back-button" onClick={onBack}>
          ‹
        </button>
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Settings</h1>
          <p>Shape LastTodo around the way you work.</p>
        </div>
      </header>
      {error && <ErrorBanner message={error} retry={async () => undefined} />}
      <div className="settings-layout">
        <nav aria-label="Settings sections">
          <button
            className={tab === 'types' ? 'active' : ''}
            onClick={() => setTab('types')}
          >
            Types <span>{data.types.length}</span>
          </button>
          <button
            className={tab === 'labels' ? 'active' : ''}
            onClick={() => setTab('labels')}
          >
            Labels <span>{data.labels.length}</span>
          </button>
          <button
            className={tab === 'backup' ? 'active' : ''}
            onClick={() => setTab('backup')}
          >
            Backup
          </button>
          <button
            className={tab === 'updates' ? 'active' : ''}
            onClick={() => setTab('updates')}
          >
            Updates
            {updateStatus?.updateAvailable && <span>New</span>}
          </button>
          <button
            className={tab === 'debug' ? 'active' : ''}
            onClick={() => setTab('debug')}
          >
            Debug
          </button>
        </nav>
        <div className="settings-content">
          {tab === 'types' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Task types</h2>
                  <p>Types are the main categories shown in your sidebar.</p>
                </div>
              </div>
              <div className="settings-list">
                {data.types.map((type) => (
                  <div className="settings-row" key={type.id}>
                    <span className="type-icon-display" aria-hidden="true">
                      {type.emoji}
                    </span>
                    <div>
                      <strong>{type.name}</strong>
                      <small>
                        {
                          data.todos.filter((todo) => todo.typeId === type.id)
                            .length
                        }{' '}
                        tasks
                      </small>
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        setTypeEdit({
                          id: type.id,
                          name: type.name,
                          emoji: type.emoji,
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Delete ${type.name}`}
                      onClick={async () => {
                        const taskCount = data.todos.filter(
                          (todo) => todo.typeId === type.id,
                        ).length;
                        const labelsLosingFinalType = data.labels.filter(
                          (label) =>
                            label.scope === 'type' &&
                            label.gatedTypeIds.length === 1 &&
                            label.gatedTypeIds[0] === type.id,
                        );
                        const labelWarning = labelsLosingFinalType.length
                          ? ` ${labelsLosingFinalType.map((label) => label.name).join(', ')} ${labelsLosingFinalType.length === 1 ? 'will no longer be assigned to any task type' : 'will no longer be assigned to any task types'}. Their values and existing task assignments will be preserved, but they will be hidden from task creation and quick filters until edited.`
                          : '';
                        const confirmed = await requestConfirmation({
                          title: `Delete the “${type.name}” type?`,
                          message: `${taskCount} active or completed ${taskCount === 1 ? 'task' : 'tasks'} will become untyped and will only appear in All tasks.${labelWarning}`,
                          confirmLabel: 'Delete type',
                          danger: true,
                        });
                        if (confirmed)
                          void mutate(() => todoApi.deleteType(type.id));
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
              </div>
              <form className="inline-create type-create" onSubmit={addType}>
                <input
                  value={newType}
                  onChange={(event) => setNewType(event.target.value)}
                  placeholder="New type name"
                />
                <button className="primary" disabled={!newType.trim() || busy}>
                  <Icon name="plus" />
                  Add type
                </button>
                {newType.trim() && (
                  <fieldset className="emoji-selector-field type-create-emoji">
                    <legend>Icon</legend>
                    <p>Choose an icon for this task type.</p>
                    <div
                      className="emoji-selector"
                      role="radiogroup"
                      aria-label="New task type icon"
                    >
                      {TYPE_EMOJI_OPTIONS.map(([emoji, label]) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={newTypeEmoji === emoji}
                          aria-label={label}
                          title={label}
                          className={newTypeEmoji === emoji ? 'active' : ''}
                          key={`${emoji}:${label}`}
                          onClick={() => setNewTypeEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </form>
            </>
          )}
          {tab === 'labels' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Labels & values</h2>
                  <p>
                    Labels can appear for every task or only for specific task
                    types.
                  </p>
                </div>
              </div>
              <div className="label-settings-list">
                {data.labels.map((label) => (
                  <details key={label.id} className="label-settings" open>
                    <summary>
                      <div>
                        <span className="label-icon">#</span>
                        <div className="label-summary-copy">
                          <div className="label-title-row">
                            <strong>{label.name}</strong>
                            <div className="label-header-actions">
                              <button
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setLabelEdit({
                                    id: label.id,
                                    name: label.name,
                                    scope:
                                      data.types.length === 0
                                        ? 'universal'
                                        : label.scope,
                                    gatedTypeIds:
                                      data.types.length === 0
                                        ? []
                                        : [...label.gatedTypeIds],
                                  });
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="delete-label"
                                onClick={async (event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const confirmed = await requestConfirmation({
                                    title: `Delete “${label.name}”?`,
                                    message:
                                      'This will delete the label and all of its values. Labels currently used by tasks cannot be deleted.',
                                    confirmLabel: 'Delete label',
                                    danger: true,
                                  });
                                  if (confirmed)
                                    void mutate(() =>
                                      todoApi.deleteLabel(label.id),
                                    );
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <small
                            className={
                              label.scope === 'type' &&
                              label.gatedTypeIds.length === 0
                                ? 'label-orphan-summary'
                                : undefined
                            }
                          >
                            {label.scope === 'universal'
                              ? 'All task types'
                              : label.gatedTypeIds.length > 0
                                ? `For ${data.types
                                    .filter((type) =>
                                      label.gatedTypeIds.includes(type.id),
                                    )
                                    .map((type) => type.name)
                                    .join(', ')}`
                                : 'No task types'}{' '}
                            · {label.cardinality}
                            {label.quickFilter ? ' · quick filter' : ''}
                          </small>
                        </div>
                      </div>
                      <span>{label.values.length} values</span>
                    </summary>
                    <div className="values">
                      <label className="quick-filter-setting">
                        <span>
                          <strong>Quick filter</strong>
                          <small>
                            Show this label’s values above applicable task
                            views.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`Enable quick filter for ${label.name}`}
                          checked={label.quickFilter}
                          disabled={busy}
                          onChange={(event) => {
                            const quickFilter = event.currentTarget.checked;
                            void mutate(() =>
                              todoApi.updateLabel(label.id, { quickFilter }),
                            );
                          }}
                        />
                        <span
                          className="quick-filter-switch"
                          aria-hidden="true"
                        />
                      </label>
                      {label.values.length === 0 && (
                        <div className="label-empty-warning" role="status">
                          <Icon name="alert" />
                          <span>
                            <strong>No values yet</strong>
                            <small>
                              This label won’t appear in task creation until it
                              has at least one value.
                            </small>
                          </span>
                        </div>
                      )}
                      {label.scope === 'type' &&
                        label.gatedTypeIds.length === 0 && (
                          <div className="label-orphan-warning" role="status">
                            <Icon name="alert" />
                            <span>
                              <strong>Not assigned to any task types</strong>
                              <small>
                                This label is hidden from task creation and
                                quick filters. Choose Edit to update its name or
                                visibility.
                              </small>
                            </span>
                          </div>
                        )}
                      <div className="value-list">
                        {label.values.map((value) => (
                          <div key={value.id}>
                            <span>{value.value}</span>
                            <button
                              className="icon-button"
                              onClick={() =>
                                startRename(
                                  'label value',
                                  value.value,
                                  (name) =>
                                    todoApi.updateLabelValue(value.id, {
                                      value: name,
                                    }),
                                )
                              }
                            >
                              <Icon name="more" />
                            </button>
                            <button
                              className="icon-button danger"
                              onClick={() =>
                                void mutate(() =>
                                  todoApi.deleteLabelValue(value.id),
                                )
                              }
                            >
                              <Icon name="x" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const value = newValue[label.id]?.trim();
                          if (value)
                            void mutate(async () => {
                              await todoApi.createLabelValue(label.id, {
                                value,
                              });
                              setNewValue({ ...newValue, [label.id]: '' });
                            });
                        }}
                      >
                        <input
                          value={newValue[label.id] ?? ''}
                          onChange={(event) =>
                            setNewValue({
                              ...newValue,
                              [label.id]: event.target.value,
                            })
                          }
                          placeholder="Add a value"
                        />
                        <button className="secondary">Add</button>
                      </form>
                    </div>
                  </details>
                ))}
              </div>
              <form className="new-label" onSubmit={addLabel}>
                <h3>Create a label</h3>
                <div className="form-grid">
                  <label className="field new-label-name">
                    <span>Name</span>
                    <input
                      value={labelForm.name}
                      onChange={(event) =>
                        setLabelForm({ ...labelForm, name: event.target.value })
                      }
                      placeholder="e.g. Product"
                    />
                  </label>
                  <div className="field label-choice-field">
                    <span className="field-heading">
                      Visibility
                      <FieldHelp text="Controls where this label is available. “All task types” shows it on every task; “Specific task types” lets you choose one or more types." />
                    </span>
                    <div
                      className="label-choice-group"
                      role="radiogroup"
                      aria-label="Label visibility"
                    >
                      {(
                        [
                          [
                            'universal',
                            'All task types',
                            'Available on every task.',
                          ],
                          [
                            'type',
                            'Specific task types',
                            'Choose one or more types.',
                          ],
                        ] as const
                      ).map(([value, title, description]) => (
                        <label
                          key={value}
                          className={
                            value === 'type' && data.types.length === 0
                              ? 'choice-disabled'
                              : undefined
                          }
                          title={
                            value === 'type' && data.types.length === 0
                              ? 'Create a task type before limiting a label to specific task types.'
                              : undefined
                          }
                        >
                          <input
                            type="radio"
                            name="label-visibility"
                            value={value}
                            checked={labelForm.scope === value}
                            disabled={
                              value === 'type' && data.types.length === 0
                            }
                            onChange={() =>
                              setLabelForm({ ...labelForm, scope: value })
                            }
                          />
                          <span className="label-choice-radio" />
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {labelForm.scope === 'type' && (
                      <div className="field type-scope-field">
                        <span>Task types</span>
                        <TaskTypeMultiSelect
                          types={data.types}
                          selected={labelForm.gatedTypeIds}
                          onChange={(gatedTypeIds) =>
                            setLabelForm({ ...labelForm, gatedTypeIds })
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className="field label-choice-field">
                    <span className="field-heading">
                      Selection
                      <FieldHelp text="Controls how many values a task can carry for this label. Single allows one choice; multiple allows any number of choices." />
                    </span>
                    <div
                      className="label-choice-group"
                      role="radiogroup"
                      aria-label="Label selection"
                    >
                      {(
                        [
                          ['single', 'Single value', 'A task can choose one.'],
                          [
                            'multi',
                            'Multiple values',
                            'A task can choose any number.',
                          ],
                        ] as const
                      ).map(([value, title, description]) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name="label-selection"
                            value={value}
                            checked={labelForm.cardinality === value}
                            onChange={() =>
                              setLabelForm({
                                ...labelForm,
                                cardinality: value,
                              })
                            }
                          />
                          <span className="label-choice-radio" />
                          <span>
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="quick-filter-setting quick-filter-create">
                    <span>
                      <strong>Quick filter</strong>
                      <small>
                        Keep these values available above applicable task views.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={labelForm.quickFilter}
                      onChange={(event) =>
                        setLabelForm({
                          ...labelForm,
                          quickFilter: event.currentTarget.checked,
                        })
                      }
                    />
                    <span className="quick-filter-switch" aria-hidden="true" />
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={
                    !labelForm.name.trim() ||
                    (labelForm.scope === 'type' &&
                      labelForm.gatedTypeIds.length === 0)
                  }
                >
                  Create label
                </button>
              </form>
            </>
          )}
          {tab === 'backup' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Local snapshots</h2>
                  <p>Keep safe, portable database copies in a synced folder.</p>
                </div>
              </div>
              <div className="backup-card">
                <div className="backup-art">
                  <Icon name="check" />
                </div>
                <div>
                  <h3>
                    {backup?.folder
                      ? 'Backups are on'
                      : 'Choose a backup folder'}
                  </h3>
                  <p>
                    {backup?.folder ??
                      'Select a Box, Drive, or other synced folder. LastTodo will create one daily snapshot there.'}
                  </p>
                  {backup?.lastBackupAt && (
                    <small>
                      Last snapshot{' '}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(backup.lastBackupAt))}
                    </small>
                  )}
                  {backup?.lastError && (
                    <small className="backup-error">{backup.lastError}</small>
                  )}
                </div>
              </div>
              <div className="backup-actions">
                <button
                  className="primary"
                  onClick={() =>
                    void mutate(async () =>
                      onBackupChange(await todoApi.chooseBackupFolder()),
                    )
                  }
                >
                  {backup?.folder ? 'Change folder' : 'Choose folder'}
                </button>
                {backup?.folder && (
                  <>
                    <button
                      className="secondary"
                      onClick={() =>
                        void mutate(async () =>
                          onBackupChange(await todoApi.runBackup()),
                        )
                      }
                    >
                      Back up now
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        void mutate(async () =>
                          onBackupChange(await todoApi.restoreFromBackup()),
                        )
                      }
                    >
                      Restore from backup
                    </button>
                  </>
                )}
              </div>
              <p className="retention-note">
                One snapshot is created per day and kept for up to 15 days.
              </p>
            </>
          )}
          {tab === 'updates' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Application updates</h2>
                  <p>
                    LastTodo checks GitHub Releases and leaves installation up
                    to you.
                  </p>
                </div>
              </div>
              <div className="update-card">
                <span className="update-card-icon">
                  <Icon
                    name={updateStatus?.updateAvailable ? 'sparkle' : 'check'}
                  />
                </span>
                <div>
                  <h3>
                    {updateStatus?.updateAvailable
                      ? `Version ${updateStatus.latestVersion} is available`
                      : updateStatus?.error
                        ? 'Update check unavailable'
                        : updateStatus
                          ? 'LastTodo is up to date'
                          : 'Checking for updates'}
                  </h3>
                  <p>
                    Installed version {updateStatus?.currentVersion ?? '…'}
                    {updateStatus?.latestVersion
                      ? ` · Latest version ${updateStatus.latestVersion}`
                      : ''}
                  </p>
                  {updateStatus?.error && (
                    <small className="update-error">{updateStatus.error}</small>
                  )}
                  {updateStatus && !updateStatus.error && (
                    <small>
                      Last checked{' '}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(updateStatus.checkedAt))}
                    </small>
                  )}
                </div>
              </div>
              <div className="update-actions">
                {updateStatus?.updateAvailable && (
                  <button className="primary" onClick={onOpenUpdateDownload}>
                    Download {updateStatus.downloadLabel} from GitHub
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={onCheckForUpdates}
                  disabled={checkingUpdates}
                >
                  {checkingUpdates ? 'Checking…' : 'Check again'}
                </button>
              </div>
              <p className="retention-note">
                Downloading opens GitHub in your browser. LastTodo never
                installs updates automatically.
              </p>
            </>
          )}
          {tab === 'debug' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Debug</h2>
                  <p>Development controls for testing application states.</p>
                </div>
              </div>
              <div className="debug-card">
                <div>
                  <h3>First-time user experience</h3>
                  <p>
                    Mark the welcome tour as unseen to show it the next time
                    LastTodo opens.
                  </p>
                </div>
                <div
                  className="debug-radio-group"
                  role="radiogroup"
                  aria-label="First-time user experience state"
                >
                  <label>
                    <input
                      type="radio"
                      name="ftue-state"
                      checked={ftueComplete === true}
                      disabled={busy || ftueComplete === null}
                      onChange={() => setFtueState(true)}
                    />
                    <span>Seen</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="ftue-state"
                      checked={ftueComplete === false}
                      disabled={busy || ftueComplete === null}
                      onChange={() => setFtueState(false)}
                    />
                    <span>Unseen</span>
                  </label>
                </div>
              </div>
              <p className="retention-note">
                This takes effect on the next application launch.
              </p>
            </>
          )}
        </div>
      </div>
      {typeEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setTypeEdit(null);
          }}
        >
          <section
            className="modal type-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="type-edit-title"
          >
            <header>
              <div>
                <p className="eyebrow">Edit task type</p>
                <h2 id="type-edit-title">Name and icon</h2>
              </div>
              <button
                className="icon-button large"
                onClick={() => setTypeEdit(null)}
                aria-label="Close"
                disabled={busy}
              >
                <Icon name="x" />
              </button>
            </header>
            <form onSubmit={submitTypeEdit}>
              <div className="form-scroll type-edit-fields">
                <label className="field title-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    value={typeEdit.name}
                    onChange={(event) =>
                      setTypeEdit({
                        ...typeEdit,
                        name: event.currentTarget.value,
                      })
                    }
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <fieldset className="emoji-selector-field">
                  <legend>Icon</legend>
                  <p>Choose an icon for this task type.</p>
                  <div
                    className="emoji-selector"
                    role="radiogroup"
                    aria-label="Task type icon"
                  >
                    {typeEmojiOptions.map(([emoji, label]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={typeEdit.emoji === emoji}
                        aria-label={label}
                        title={label}
                        className={typeEdit.emoji === emoji ? 'active' : ''}
                        key={`${emoji}:${label}`}
                        onClick={() => setTypeEdit({ ...typeEdit, emoji })}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setTypeEdit(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={!typeEdit.name.trim() || busy}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {labelEdit && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setLabelEdit(null);
          }}
        >
          <section
            className="modal label-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="label-edit-title"
          >
            <header>
              <div>
                <p className="eyebrow">Edit label</p>
                <h2 id="label-edit-title">Name and visibility</h2>
              </div>
              <button
                className="icon-button large"
                onClick={() => setLabelEdit(null)}
                aria-label="Close"
                disabled={busy}
              >
                <Icon name="x" />
              </button>
            </header>
            <form onSubmit={submitLabelEdit}>
              <div className="form-scroll label-edit-fields">
                <label className="field title-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    value={labelEdit.name}
                    onChange={(event) =>
                      setLabelEdit({
                        ...labelEdit,
                        name: event.currentTarget.value,
                      })
                    }
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <div className="field label-choice-field">
                  <span className="field-heading">Visibility</span>
                  <div
                    className="label-choice-group"
                    role="radiogroup"
                    aria-label="Label visibility"
                  >
                    <label>
                      <input
                        type="radio"
                        name="edit-label-visibility"
                        value="universal"
                        checked={labelEdit.scope === 'universal'}
                        onChange={() =>
                          setLabelEdit({
                            ...labelEdit,
                            scope: 'universal',
                          })
                        }
                      />
                      <span className="label-choice-radio" />
                      <span>
                        <strong>All task types</strong>
                        <small>Available on every task.</small>
                      </span>
                    </label>
                    <label
                      className={
                        data.types.length === 0 ? 'choice-disabled' : undefined
                      }
                      title={
                        data.types.length === 0
                          ? 'Create a task type before limiting a label to specific task types.'
                          : undefined
                      }
                    >
                      <input
                        type="radio"
                        name="edit-label-visibility"
                        value="type"
                        checked={labelEdit.scope === 'type'}
                        disabled={data.types.length === 0}
                        onChange={() =>
                          setLabelEdit({ ...labelEdit, scope: 'type' })
                        }
                      />
                      <span className="label-choice-radio" />
                      <span>
                        <strong>Specific task types</strong>
                        <small>
                          {data.types.length === 0
                            ? 'Create a task type first.'
                            : 'Choose one or more types.'}
                        </small>
                      </span>
                    </label>
                  </div>
                  {labelEdit.scope === 'type' && (
                    <div className="field type-scope-field">
                      <span>Task types</span>
                      <TaskTypeMultiSelect
                        types={data.types}
                        selected={labelEdit.gatedTypeIds}
                        onChange={(gatedTypeIds) =>
                          setLabelEdit({ ...labelEdit, gatedTypeIds })
                        }
                      />
                      {labelEdit.gatedTypeIds.length === 0 && (
                        <small className="label-edit-validation">
                          Choose at least one task type to save.
                        </small>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setLabelEdit(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    !labelEdit.name.trim() ||
                    (labelEdit.scope === 'type' &&
                      labelEdit.gatedTypeIds.length === 0) ||
                    busy
                  }
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {renameTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setRenameTarget(null);
          }}
        >
          <section
            className="modal rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
          >
            <header>
              <div>
                <p className="eyebrow">Rename {renameTarget.label}</p>
                <h2 id="rename-title">Choose a new name</h2>
              </div>
              <button
                className="icon-button large"
                onClick={() => setRenameTarget(null)}
                aria-label="Close"
                disabled={busy}
              >
                <Icon name="x" />
              </button>
            </header>
            <form onSubmit={submitRename}>
              <div className="form-scroll">
                <label className="field title-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) =>
                      setRenameValue(event.currentTarget.value)
                    }
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRenameTarget(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={!renameValue.trim() || busy}
                >
                  {busy ? 'Saving…' : 'Save name'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
