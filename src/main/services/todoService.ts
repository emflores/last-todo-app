import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CreateTodoInput,
  LabelValue,
  Todo,
  TodoLabelInput,
  TodoLink,
  TodoLinkInput,
  TodoQuery,
  UpdateTodoInput,
} from '../../shared/contracts';
import { AppDatabase } from '../database/database';

type TodoRow = {
  id: string;
  title: string;
  type_id: string | null;
  type_name: string | null;
  due_date: string | null;
  effective_due_date: string | null;
  description: string | null;
  parent_id: string | null;
  parent_title: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  sensitive: number;
  child_total: number;
  child_completed: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requiredText(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function validateDate(value: string | null | undefined): void {
  if (value != null && !ISO_DATE.test(value))
    throw new Error('Due date must use YYYY-MM-DD format');
}

export class TodoService {
  constructor(private readonly database: AppDatabase) {}

  list(query: TodoQuery = {}): Todo[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.completedOnly) conditions.push('t.completed_at IS NOT NULL');
    else if (!query.includeCompleted) conditions.push('t.completed_at IS NULL');

    if (query.typeIds?.length) {
      conditions.push(
        `t.type_id IN (${query.typeIds.map(() => '?').join(',')})`,
      );
      params.push(...query.typeIds);
    }
    for (const valueId of query.labelValueIds ?? []) {
      conditions.push(`EXISTS (SELECT 1 FROM todo_labels f
        WHERE f.todo_id = t.id AND f.label_value_id = ?)`);
      params.push(valueId);
    }
    if (query.search?.trim()) {
      conditions.push(
        `(t.title LIKE ? ESCAPE '\\' OR COALESCE(t.description, '') LIKE ? ESCAPE '\\')`,
      );
      const escaped = query.search.trim().replace(/[\\%_]/g, '\\$&');
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (Object.prototype.hasOwnProperty.call(query, 'parentId')) {
      if (query.parentId == null) conditions.push('t.parent_id IS NULL');
      else {
        conditions.push('t.parent_id = ?');
        params.push(query.parentId);
      }
    } else if (query.rootOnly) conditions.push('t.parent_id IS NULL');
    if (query.dueFrom) {
      validateDate(query.dueFrom);
      conditions.push('COALESCE(t.due_date, p.due_date) >= ?');
      params.push(query.dueFrom);
    }
    if (query.dueTo) {
      validateDate(query.dueTo);
      conditions.push('COALESCE(t.due_date, p.due_date) <= ?');
      params.push(query.dueTo);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database.db
      .prepare(
        `${this.baseSelect()} ${where}
      ORDER BY effective_due_date ASC,
        COALESCE((SELECT MAX(CASE lv.value WHEN 'High' THEN 3 WHEN 'Medium' THEN 2
          WHEN 'Med' THEN 2 WHEN 'Low' THEN 1 ELSE 0 END)
          FROM todo_labels tl JOIN label_values lv ON lv.id = tl.label_value_id
          JOIN labels pri ON pri.id = tl.label_id WHERE tl.todo_id = t.id AND pri.name = 'Priority'), 0) DESC,
        t.created_at ASC`,
      )
      .all(...params) as TodoRow[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Todo {
    const row = this.database.db
      .prepare(`${this.baseSelect()} WHERE t.id = ?`)
      .get(id) as TodoRow | undefined;
    if (!row) throw new Error('Todo not found');
    return this.hydrate(row);
  }

  async create(input: CreateTodoInput): Promise<Todo> {
    const id = randomUUID();
    await this.database.write((db) => {
      const title = requiredText(input.title, 'Title');
      validateDate(input.dueDate);
      const typeId = input.typeId ?? null;
      this.assertType(db, typeId);
      const parentId = input.parentId ?? null;
      this.assertValidParent(db, id, parentId, false);
      if (!parentId && !input.dueDate)
        throw new Error('Due date is required for a parent todo');
      const timestamp = new Date().toISOString();
      db.prepare(
        `INSERT INTO todos
        (id,title,type_id,due_date,description,parent_id,created_at,updated_at,completed_at,sensitive)
        VALUES (?,?,?,?,?,?,?,?,NULL,?)`,
      ).run(
        id,
        title,
        typeId,
        input.dueDate ?? null,
        input.description?.trim() || null,
        parentId,
        timestamp,
        timestamp,
        input.sensitive ? 1 : 0,
      );
      this.replaceLabels(db, id, typeId, input.labels ?? []);
      this.replaceLinks(db, id, input.links ?? []);
      if (parentId) this.reopenParent(db, parentId, timestamp);
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateTodoInput): Promise<Todo> {
    await this.database.write((db) => {
      const old = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined;
      if (!old) throw new Error('Todo not found');
      const title =
        input.title === undefined
          ? (old.title as string)
          : requiredText(input.title, 'Title');
      const typeId =
        input.typeId === undefined
          ? (old.type_id as string | null)
          : input.typeId;
      const dueDate =
        input.dueDate === undefined
          ? (old.due_date as string | null)
          : input.dueDate;
      const parentId =
        input.parentId === undefined
          ? (old.parent_id as string | null)
          : input.parentId;
      const description =
        input.description === undefined
          ? (old.description as string | null)
          : input.description?.trim() || null;
      const sensitive =
        input.sensitive === undefined
          ? Number(old.sensitive)
          : input.sensitive
            ? 1
            : 0;
      validateDate(dueDate);
      this.assertType(db, typeId);
      this.assertValidParent(db, id, parentId, true);
      if (!parentId && !dueDate)
        throw new Error('Due date is required for a parent todo');
      db.prepare(
        `UPDATE todos SET title=?, type_id=?, due_date=?, description=?, parent_id=?, sensitive=?, updated_at=?
        WHERE id=?`,
      ).run(
        title,
        typeId,
        dueDate,
        description,
        parentId,
        sensitive,
        new Date().toISOString(),
        id,
      );
      if (input.labels !== undefined)
        this.replaceLabels(db, id, typeId, input.labels);
      else if (typeId !== old.type_id)
        this.assertExistingLabelsAllowed(db, id, typeId);
      if (input.links !== undefined) this.replaceLinks(db, id, input.links);
      if (parentId && old.completed_at == null) {
        this.reopenParent(db, parentId, new Date().toISOString());
      }
    });
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    await this.database.write((db) => {
      const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
      if (!result.changes) throw new Error('Todo not found');
    });
  }

  async setCompleted(id: string, completed: boolean): Promise<Todo> {
    await this.database.write((db) => {
      const todo = db
        .prepare('SELECT id, parent_id FROM todos WHERE id = ?')
        .get(id) as { id: string; parent_id: string | null } | undefined;
      if (!todo) throw new Error('Todo not found');
      if (completed) {
        const activeChildren = db
          .prepare(
            'SELECT COUNT(*) AS count FROM todos WHERE parent_id = ? AND completed_at IS NULL',
          )
          .get(id) as { count: number };
        if (activeChildren.count > 0)
          throw new Error('Complete or delete every child first');
      }
      db.prepare(
        'UPDATE todos SET completed_at = ?, updated_at = ? WHERE id = ?',
      ).run(
        completed ? new Date().toISOString() : null,
        new Date().toISOString(),
        id,
      );
      if (!completed && todo.parent_id) {
        this.reopenParent(db, todo.parent_id, new Date().toISOString());
      }
    });
    return this.get(id);
  }

  private baseSelect(): string {
    return `SELECT t.*, ty.name AS type_name, p.title AS parent_title,
      COALESCE(t.due_date, p.due_date) AS effective_due_date,
      (SELECT COUNT(*) FROM todos c WHERE c.parent_id=t.id) AS child_total,
      (SELECT COUNT(*) FROM todos c WHERE c.parent_id=t.id AND c.completed_at IS NOT NULL) AS child_completed
      FROM todos t LEFT JOIN types ty ON ty.id=t.type_id LEFT JOIN todos p ON p.id=t.parent_id`;
  }

  private reopenParent(
    db: Database.Database,
    parentId: string,
    timestamp: string,
  ): void {
    db.prepare(
      'UPDATE todos SET completed_at = NULL, updated_at = ? WHERE id = ? AND completed_at IS NOT NULL',
    ).run(timestamp, parentId);
  }

  private hydrate(row: TodoRow): Todo {
    if (!row.effective_due_date)
      throw new Error(`Todo ${row.id} has no effective due date`);
    const labelRows = this.database.db
      .prepare(
        `SELECT l.id AS label_id, l.name AS label_name,
      lv.id, lv.label_id, lv.value, lv.sort_order
      FROM todo_labels tl JOIN labels l ON l.id=tl.label_id
      JOIN label_values lv ON lv.id=tl.label_value_id WHERE tl.todo_id=?
      ORDER BY l.sort_order, lv.sort_order`,
      )
      .all(row.id) as Array<{
      label_id: string;
      label_name: string;
      id: string;
      value: string;
      sort_order: number;
    }>;
    const labels = new Map<
      string,
      { labelId: string; labelName: string; values: LabelValue[] }
    >();
    for (const item of labelRows) {
      const selection = labels.get(item.label_id) ?? {
        labelId: item.label_id,
        labelName: item.label_name,
        values: [],
      };
      selection.values.push({
        id: item.id,
        labelId: item.label_id,
        value: item.value,
        sortOrder: item.sort_order,
      });
      labels.set(item.label_id, selection);
    }
    const links = this.database.db
      .prepare(
        `SELECT id, label, url, sort_order FROM todo_links
      WHERE todo_id=? ORDER BY sort_order`,
      )
      .all(row.id) as Array<{
      id: string;
      label: string | null;
      url: string;
      sort_order: number;
    }>;
    return {
      id: row.id,
      title: row.title,
      typeId: row.type_id,
      typeName: row.type_name,
      dueDate: row.due_date,
      effectiveDueDate: row.effective_due_date,
      description: row.description,
      parentId: row.parent_id,
      parentTitle: row.parent_title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      sensitive: Boolean(row.sensitive),
      labels: [...labels.values()],
      links: links.map(
        (link): TodoLink => ({
          id: link.id,
          label: link.label,
          url: link.url,
          sortOrder: link.sort_order,
        }),
      ),
      childProgress: { completed: row.child_completed, total: row.child_total },
    };
  }

  private assertType(db: Database.Database, id: string | null): void {
    if (id === null) return;
    if (!db.prepare('SELECT 1 FROM types WHERE id=?').get(id))
      throw new Error('Type not found');
  }

  private assertValidParent(
    db: Database.Database,
    id: string,
    parentId: string | null,
    updating: boolean,
  ): void {
    if (!parentId) return;
    if (parentId === id) throw new Error('A todo cannot be its own parent');
    const parent = db
      .prepare('SELECT parent_id FROM todos WHERE id=?')
      .get(parentId) as { parent_id: string | null } | undefined;
    if (!parent) throw new Error('Parent todo not found');
    if (parent.parent_id) throw new Error('Children cannot have children');
    if (updating) {
      const children = db
        .prepare('SELECT 1 FROM todos WHERE parent_id=? LIMIT 1')
        .get(id);
      if (children)
        throw new Error('A todo with children cannot become a child');
    }
  }

  private replaceLabels(
    db: Database.Database,
    todoId: string,
    typeId: string | null,
    labels: TodoLabelInput[],
  ): void {
    const seen = new Set<string>();
    for (const selection of labels) {
      if (seen.has(selection.labelId))
        throw new Error('A label may only be specified once');
      seen.add(selection.labelId);
      const label = db
        .prepare('SELECT id,scope,cardinality FROM labels WHERE id=?')
        .get(selection.labelId) as
        | {
            id: string;
            scope: string;
            cardinality: string;
          }
        | undefined;
      if (!label) throw new Error('Label not found');
      if (
        label.scope === 'type' &&
        (!typeId ||
          !db
            .prepare('SELECT 1 FROM label_types WHERE label_id=? AND type_id=?')
            .get(selection.labelId, typeId)) &&
        (typeId !== null ||
          !db
            .prepare('SELECT 1 FROM todo_labels WHERE todo_id=? AND label_id=?')
            .get(todoId, selection.labelId))
      ) {
        throw new Error('This label is not available for the selected type');
      }
      const values = [...new Set(selection.valueIds)];
      if (label.cardinality === 'single' && values.length > 1) {
        throw new Error('This label accepts only one value');
      }
      for (const valueId of values) {
        const value = db
          .prepare('SELECT 1 FROM label_values WHERE id=? AND label_id=?')
          .get(valueId, selection.labelId);
        if (!value) throw new Error('Label value does not belong to its label');
      }
    }
    db.prepare('DELETE FROM todo_labels WHERE todo_id=?').run(todoId);
    const insert = db.prepare(
      'INSERT INTO todo_labels (todo_id,label_id,label_value_id) VALUES (?,?,?)',
    );
    for (const selection of labels) {
      for (const valueId of new Set(selection.valueIds))
        insert.run(todoId, selection.labelId, valueId);
    }
  }

  private assertExistingLabelsAllowed(
    db: Database.Database,
    todoId: string,
    typeId: string | null,
  ): void {
    if (typeId === null) return;
    const invalid = db
      .prepare(
        `SELECT 1 FROM todo_labels tl JOIN labels l ON l.id=tl.label_id
        WHERE tl.todo_id=? AND l.scope='type'
        AND NOT EXISTS (
          SELECT 1 FROM label_types lt
          WHERE lt.label_id=l.id AND lt.type_id=?
        ) LIMIT 1`,
      )
      .get(todoId, typeId);
    if (invalid)
      throw new Error(
        'Remove type-specific labels before changing the todo type',
      );
  }

  private replaceLinks(
    db: Database.Database,
    todoId: string,
    links: TodoLinkInput[],
  ): void {
    for (const link of links) requiredText(link.url, 'Link URL');
    db.prepare('DELETE FROM todo_links WHERE todo_id=?').run(todoId);
    const insert = db.prepare(
      'INSERT INTO todo_links (id,todo_id,label,url,sort_order) VALUES (?,?,?,?,?)',
    );
    links.forEach((link, index) =>
      insert.run(
        link.id ?? randomUUID(),
        todoId,
        link.label?.trim() || null,
        link.url.trim(),
        link.sortOrder ?? index,
      ),
    );
  }
}
