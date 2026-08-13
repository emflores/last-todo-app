import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
  typeId: '',
  dueDate: localISO(new Date()),
  description: '',
  parentId: null,
  sensitive: false,
  labelValueIds: [],
  links: [],
};

type LaneKey = 'overdue' | 'today' | 'week' | 'month' | 'future';
type LayoutMode = 'board' | 'list';
type StatusFilter = 'active' | 'all' | 'completed';
type DueFilter = 'any' | LaneKey;
type PriorityFilter = 'any' | 'high' | 'medium' | 'low' | 'none';
type SortMode = 'due' | 'priority' | 'created' | 'title';
type SettingsTab = 'types' | 'labels' | 'backup' | 'updates';
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

function personName(value: string) {
  const [firstName = value, ...rest] = value.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
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
  const [selectedPerson, setSelectedPerson] = useState<string>('all');
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

  useEffect(() => {
    void refresh();
    todoApi
      .getBackupStatus()
      .then(setBackupStatus)
      .catch(() => undefined);
    void checkForUpdates();
  }, [checkForUpdates]);
  useEffect(() => {
    window.localStorage.setItem('lasttodo:layout', layout);
  }, [layout]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setQuickParentId(null);
        setEditing(null);
      }
      if (event.key === 'Escape') setEditing(undefined);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
  const peopleLabel = data.labels.find(
    (label) => label.name.toLowerCase() === 'people',
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
            selectedPerson !== 'all' &&
            !todo.labels.some((label) => label.labelValueId === selectedPerson)
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
      selectedPerson,
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
  const selectedPersonName = peopleLabel?.values.find(
    (value) => value.id === selectedPerson,
  )?.value;
  const title =
    view === 'people'
      ? (selectedPersonName ?? 'People')
      : (selectedTypeName ?? 'My tasks');

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
    const isPeople = data.types.some(
      (type) => type.id === typeId && type.name.toLowerCase() === 'people',
    );
    setView(isPeople ? 'people' : 'board');
    setSelectedType(typeId);
    setSelectedPerson('all');
  };
  const hasActiveFilters =
    selectedType !== 'all' ||
    selectedPerson !== 'all' ||
    dueFilter !== 'any' ||
    priorityFilter !== 'any' ||
    statusFilter !== 'active' ||
    sortMode !== 'due';
  const resetFilters = () => {
    setSelectedType('all');
    setSelectedPerson('all');
    setDueFilter('any');
    setPriorityFilter('any');
    setStatusFilter('active');
    setSortMode('due');
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
            setSelectedPerson('all');
          }}
        >
          <Icon name="inbox" />
          <span>My tasks</span>
          <span className="count">{activeCount}</span>
        </button>
        <div className="rail-section-heading">
          <span>Types</span>
        </div>
        <nav aria-label="Task types">
          {data.types.map((type, index) => (
            <button
              key={type.id}
              className={`rail-row ${view !== 'settings' && selectedType === type.id ? 'active' : ''}`}
              onClick={() => selectTypeView(type.id)}
            >
              <span className={`type-dot dot-${index % 5}`} />
              <span>{type.name}</span>
            </button>
          ))}
        </nav>
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
              <button className="primary" onClick={() => openCreate()}>
                <Icon name="plus" />
                New task <kbd>⌘N</kbd>
              </button>
            </header>
            {updateStatus?.updateAvailable && !updateBannerDismissed && (
              <UpdateAvailableBanner
                version={updateStatus.latestVersion!}
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
                <p className="eyebrow">
                  {timeGreeting()} ·{' '}
                  {view === 'people' ? 'Working with' : 'Workspace'}
                </p>
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
                  onClick={() => setLayout('board')}
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
            {view === 'people' && (
              <nav className="people-quick-view" aria-label="Filter by person">
                <button
                  className={selectedPerson === 'all' ? 'active' : ''}
                  onClick={() => setSelectedPerson('all')}
                >
                  <span className="person-avatar">
                    <Icon name="people" />
                  </span>
                  <span className="person-name">
                    <strong>Everyone</strong>
                    <small>All people</small>
                  </span>
                </button>
                {peopleLabel?.values.map((person) => {
                  const { firstName, lastName } = personName(person.value);
                  return (
                    <button
                      key={person.id}
                      className={selectedPerson === person.id ? 'active' : ''}
                      onClick={() => setSelectedPerson(person.id)}
                    >
                      <span className="person-avatar">
                        {firstName.slice(0, 1)}
                        {lastName.slice(0, 1)}
                      </span>
                      <span className="person-name">
                        <strong>{firstName}</strong>
                        <small>{lastName || 'Person'}</small>
                      </span>
                    </button>
                  );
                })}
              </nav>
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
                types={data.types}
                selectedType={selectedType}
                onTypeChange={selectTypeView}
                due={dueFilter}
                onDueChange={setDueFilter}
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
              <section className="board" aria-label="Tasks by due date">
                {LANES.map((lane) => (
                  <div className={`lane lane-${lane.id}`} key={lane.id}>
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
          data={data}
          busy={busy}
          onClose={() => setEditing(undefined)}
          onSave={(draft, keepOpen) =>
            mutate(async () => {
              if (editing) await todoApi.updateTodo(editing.id, draft);
              else await todoApi.createTodo(draft);
              if (!keepOpen) setEditing(undefined);
            })
          }
          onDelete={
            editing
              ? () =>
                  mutate(async () => {
                    const hasChildren = editing.children.length > 0;
                    if (
                      !hasChildren ||
                      window.confirm(
                        `Delete “${editing.title}”${hasChildren ? ' and all of its child tasks' : ''}? This cannot be undone.`,
                      )
                    ) {
                      await todoApi.deleteTodo(editing.id);
                      setEditing(undefined);
                    }
                  })
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
  onDownload,
  onDismiss,
}: {
  version: string;
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
          Download the new DMG from GitHub and install it when you’re ready.
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

function FilterBar({
  types,
  selectedType,
  onTypeChange,
  due,
  onDueChange,
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
              {type.name}
            </option>
          ))}
        </select>
      </label>
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
}: {
  todos: Todo[];
  types: TodoType[];
  allTodos: Todo[];
  onEdit: (todo: Todo) => void;
  onToggle: (todo: Todo) => Promise<void>;
  onAddChild: (todo: Todo) => void;
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
}: {
  todo: Todo;
  types: TodoType[];
  allTodos: Todo[];
  onEdit: (todo: Todo) => void;
  onToggle: (todo: Todo) => Promise<void>;
  onAddChild: (todo: Todo) => void;
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
        <span className="list-type">{type?.name ?? 'Task'}</span>
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
      {todo.children.map((child) => {
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
            <span className="list-type">{childType?.name ?? 'Task'}</span>
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
}: {
  todo: Todo;
  types: TodoType[];
  allTodos: Todo[];
  onEdit: () => void;
  onToggle: () => Promise<void>;
  onToggleChild: (child: Todo) => Promise<void>;
  onAddChild: () => void;
  onEditChild: (child: Todo) => void;
}) {
  const [completing, setCompleting] = useState(false);
  const completeChildren = todo.children.filter(
    (child) => child.completedAt,
  ).length;
  const canComplete =
    !todo.children.length || completeChildren === todo.children.length;
  const type = types.find((candidate) => candidate.id === todo.typeId);
  const people = todo.labels.filter(
    (label) => label.labelName.toLowerCase() === 'people',
  );
  const cardLabels = todo.labels.filter(
    (label) => label.labelName.toLowerCase() !== 'people',
  );
  const dueLane = laneFor(todo, allTodos);
  const priorityLevel = priorityName(todo);
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
            {type?.name ?? 'Task'}
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
        {people.length > 0 && (
          <span
            className="card-people"
            aria-label={`People: ${people.map((person) => person.value).join(', ')}`}
          >
            {people.slice(0, 3).map((person) => {
              const { firstName, lastName } = personName(person.value);
              return (
                <i
                  key={person.labelValueId}
                  title={person.value}
                  aria-hidden="true"
                >
                  {firstName.slice(0, 1)}
                  {lastName.slice(0, 1)}
                </i>
              );
            })}
            {people.length > 3 && <b>+{people.length - 3}</b>}
          </span>
        )}
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
      {todo.children.length > 0 && (
        <div className="children-preview">
          {todo.children.map((child) => (
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
  data,
  busy,
  onClose,
  onSave,
  onDelete,
  onQuickChild,
}: {
  todo: Todo | null;
  parentId: string | null;
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
    : { ...EMPTY_DRAFT, typeId: data.types[0]?.id ?? '', parentId };
  const [draft, setDraft] = useState<TodoDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const isChild = Boolean(draft.parentId);
  const availableLabels = data.labels.filter(
    (label) =>
      label.scope === 'universal' || label.gatedTypeId === draft.typeId,
  );
  const valid = Boolean(
    draft.title.trim() && draft.typeId && (draft.dueDate || isChild),
  );

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
          <div>
            <p className="eyebrow">
              {todo ? 'Task details' : isChild ? 'New child task' : 'New task'}
            </p>
            <h2 id="task-modal-title">
              {todo ? 'Edit task' : 'Capture something'}
            </h2>
          </div>
          <button
            className="icon-button large"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </header>
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
                <span>
                  Type <b>*</b>
                </span>
                <select
                  value={draft.typeId}
                  onChange={(event) => {
                    const typeId = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      typeId,
                      labelValueIds: [],
                    }));
                  }}
                  className={attempted && !draft.typeId ? 'invalid' : ''}
                >
                  <option value="">Choose type…</option>
                  {data.types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
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
            <label className="field">
              <span>Parent task</span>
              <select
                value={draft.parentId ?? ''}
                disabled={Boolean(todo?.children.length)}
                onChange={(event) => {
                  const parentId = event.currentTarget.value || null;
                  setDraft((current) => ({ ...current, parentId }));
                }}
              >
                <option value="">None — this is a top-level task</option>
                {data.todos
                  .filter(
                    (candidate) =>
                      !candidate.parentId &&
                      candidate.id !== todo?.id &&
                      !candidate.completedAt,
                  )
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
              </select>
            </label>
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
                                setLabel(label, value.id, event.target.checked)
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
            <button className="primary" value="save" disabled={busy || !valid}>
              {busy ? 'Saving…' : todo ? 'Save changes' : 'Create task'}
            </button>
          </footer>
        </form>
      </section>
    </div>
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
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [newType, setNewType] = useState('');
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [renameTarget, setRenameTarget] = useState<{
    label: string;
    initial: string;
    action: (name: string) => Promise<void>;
  } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [labelForm, setLabelForm] = useState<{
    name: string;
    scope: 'universal' | 'type';
    gatedTypeId: string;
    valueKind: 'enum' | 'user_managed';
    cardinality: 'single' | 'multi';
  }>({
    name: '',
    scope: 'universal',
    gatedTypeId: '',
    valueKind: 'enum',
    cardinality: 'single',
  });
  const addType = (event: FormEvent) => {
    event.preventDefault();
    if (!newType.trim()) return;
    void mutate(async () => {
      await todoApi.createType({ name: newType.trim() });
      setNewType('');
    });
  };
  const addLabel = (event: FormEvent) => {
    event.preventDefault();
    if (!labelForm.name.trim()) return;
    void mutate(async () => {
      await todoApi.createLabel({
        ...labelForm,
        name: labelForm.name.trim(),
        gatedTypeId: labelForm.scope === 'type' ? labelForm.gatedTypeId : null,
      });
      setLabelForm({
        name: '',
        scope: 'universal',
        gatedTypeId: '',
        valueKind: 'enum',
        cardinality: 'single',
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
                {data.types.map((type, index) => (
                  <div className="settings-row" key={type.id}>
                    <span className={`type-dot dot-${index % 5}`} />
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
                        startRename('task type', type.name, (name) =>
                          todoApi.updateType(type.id, { name }),
                        )
                      }
                    >
                      Rename
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Delete ${type.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete the “${type.name}” type?`))
                          void mutate(() => todoApi.deleteType(type.id));
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
              </div>
              <form className="inline-create" onSubmit={addType}>
                <input
                  value={newType}
                  onChange={(event) => setNewType(event.target.value)}
                  placeholder="New type name"
                />
                <button className="primary" disabled={!newType.trim() || busy}>
                  <Icon name="plus" />
                  Add type
                </button>
              </form>
            </>
          )}
          {tab === 'labels' && (
            <>
              <div className="content-heading">
                <div>
                  <h2>Labels & values</h2>
                  <p>
                    Universal labels appear everywhere. Gated labels appear for
                    one type.
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
                                  startRename('label', label.name, (name) =>
                                    todoApi.updateLabel(label.id, { name }),
                                  );
                                }}
                              >
                                Rename
                              </button>
                              <button
                                className="delete-label"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (
                                    window.confirm(
                                      `Delete “${label.name}” and its values?`,
                                    )
                                  )
                                    void mutate(() =>
                                      todoApi.deleteLabel(label.id),
                                    );
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <small>
                            {label.scope === 'universal'
                              ? 'Universal'
                              : `For ${data.types.find((type) => type.id === label.gatedTypeId)?.name ?? 'type'} only`}{' '}
                            · {label.cardinality}
                          </small>
                        </div>
                      </div>
                      <span>{label.values.length} values</span>
                    </summary>
                    <div className="values">
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
                          placeholder={
                            label.valueKind === 'user_managed'
                              ? 'Add a person or value'
                              : 'Add a value'
                          }
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
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={labelForm.name}
                      onChange={(event) =>
                        setLabelForm({ ...labelForm, name: event.target.value })
                      }
                      placeholder="e.g. Product"
                    />
                  </label>
                  <label className="field">
                    <span>Visibility</span>
                    <select
                      value={labelForm.scope}
                      onChange={(event) =>
                        setLabelForm({
                          ...labelForm,
                          scope: event.target.value as 'universal' | 'type',
                        })
                      }
                    >
                      <option value="universal">All task types</option>
                      <option value="type">One task type</option>
                    </select>
                  </label>
                  {labelForm.scope === 'type' && (
                    <label className="field">
                      <span>Task type</span>
                      <select
                        value={labelForm.gatedTypeId}
                        onChange={(event) =>
                          setLabelForm({
                            ...labelForm,
                            gatedTypeId: event.target.value,
                          })
                        }
                      >
                        <option value="">Choose…</option>
                        {data.types.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span>Selection</span>
                    <select
                      value={labelForm.cardinality}
                      onChange={(event) =>
                        setLabelForm({
                          ...labelForm,
                          cardinality: event.target.value as 'single' | 'multi',
                        })
                      }
                    >
                      <option value="single">Single value</option>
                      <option value="multi">Multiple values</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Values</span>
                    <select
                      value={labelForm.valueKind}
                      onChange={(event) =>
                        setLabelForm({
                          ...labelForm,
                          valueKind: event.target.value as
                            | 'enum'
                            | 'user_managed',
                        })
                      }
                    >
                      <option value="enum">Fixed list</option>
                      <option value="user_managed">Managed as you work</option>
                    </select>
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={
                    !labelForm.name.trim() ||
                    (labelForm.scope === 'type' && !labelForm.gatedTypeId)
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
                      onClick={() => {
                        if (
                          window.confirm(
                            'Restore the newest snapshot? Current local changes will be replaced.',
                          )
                        ) {
                          void mutate(async () =>
                            onBackupChange(await todoApi.restoreLatestBackup()),
                          );
                        }
                      }}
                    >
                      Restore latest
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
                    Download DMG from GitHub
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
        </div>
      </div>
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
