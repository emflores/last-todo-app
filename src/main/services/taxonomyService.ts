import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CreateLabelInput,
  CreateLabelValueInput,
  CreateTypeInput,
  LabelDefinition,
  LabelValue,
  Taxonomy,
  TodoType,
  UpdateLabelInput,
  UpdateLabelValueInput,
  UpdateTypeInput,
} from '../../shared/contracts';
import { AppDatabase } from '../database/database';

function name(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Name is required');
  return trimmed;
}

function comparableValue(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function uniqueTypeIds(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function emoji(value: string | undefined): string {
  const trimmed = value?.trim() || '🏷️';
  if (Array.from(trimmed).length > 8) throw new Error('Emoji is too long');
  return trimmed;
}

export class TaxonomyService {
  constructor(private readonly database: AppDatabase) {}

  list(): Taxonomy {
    const types = this.database.db
      .prepare(
        'SELECT id,name,emoji,sort_order FROM types ORDER BY sort_order,name',
      )
      .all() as Array<{
      id: string;
      name: string;
      emoji: string;
      sort_order: number;
    }>;
    const labels = this.database.db
      .prepare('SELECT * FROM labels ORDER BY sort_order,name')
      .all() as Array<{
      id: string;
      name: string;
      scope: 'universal' | 'type';
      gated_type_id: string | null;
      cardinality: 'single' | 'multi';
      quick_filter: number;
      sort_order: number;
    }>;
    const values = this.database.db
      .prepare(
        'SELECT id,label_id,value,sort_order FROM label_values ORDER BY sort_order,value',
      )
      .all() as Array<{
      id: string;
      label_id: string;
      value: string;
      sort_order: number;
    }>;
    const labelTypes = this.database.db
      .prepare('SELECT label_id,type_id FROM label_types ORDER BY type_id')
      .all() as Array<{ label_id: string; type_id: string }>;
    return {
      types: types.map((type) => ({
        id: type.id,
        name: type.name,
        emoji: type.emoji,
        sortOrder: type.sort_order,
      })),
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        scope: label.scope,
        gatedTypeIds: labelTypes
          .filter((item) => item.label_id === label.id)
          .map((item) => item.type_id),
        cardinality: label.cardinality,
        quickFilter: Boolean(label.quick_filter),
        sortOrder: label.sort_order,
        values: values
          .filter((value) => value.label_id === label.id)
          .map((value) => ({
            id: value.id,
            labelId: value.label_id,
            value: value.value,
            sortOrder: value.sort_order,
          })),
      })),
    };
  }

  async createType(input: CreateTypeInput): Promise<TodoType> {
    const id = randomUUID();
    await this.database.write((db) => {
      const typeName = name(input.name);
      this.assertUniqueTypeName(db, typeName);
      db
        .prepare(
          'INSERT INTO types (id,name,emoji,sort_order) VALUES (?,?,?,?)',
        )
        .run(id, typeName, emoji(input.emoji), input.sortOrder ?? 0);
    });
    return this.type(id);
  }

  async updateType(id: string, input: UpdateTypeInput): Promise<TodoType> {
    await this.database.write((db) => {
      const old = db.prepare('SELECT * FROM types WHERE id=?').get(id) as
        | { name: string; emoji: string; sort_order: number }
        | undefined;
      if (!old) throw new Error('Type not found');
      const typeName = input.name === undefined ? old.name : name(input.name);
      this.assertUniqueTypeName(db, typeName, id);
      db.prepare('UPDATE types SET name=?,emoji=?,sort_order=? WHERE id=?').run(
        typeName,
        input.emoji === undefined ? old.emoji : emoji(input.emoji),
        input.sortOrder ?? old.sort_order,
        id,
      );
    });
    return this.type(id);
  }

  async deleteType(id: string): Promise<void> {
    await this.database.write((db) => {
      try {
        const result = db.prepare('DELETE FROM types WHERE id=?').run(id);
        if (!result.changes) throw new Error('Type not found');
      } catch (error) {
        if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
          throw new Error('Type is in use and cannot be deleted');
        }
        throw error;
      }
    });
  }

  async createLabel(input: CreateLabelInput): Promise<LabelDefinition> {
    const id = randomUUID();
    await this.database.write((db) => {
      const labelName = name(input.name);
      this.assertUniqueLabelName(db, labelName);
      const gatedTypeIds =
        input.scope === 'type' ? uniqueTypeIds(input.gatedTypeIds) : [];
      this.validateLabel(db, input.scope, gatedTypeIds, input.cardinality);
      db.prepare(
        `INSERT INTO labels
        (id,name,scope,gated_type_id,value_kind,cardinality,quick_filter,sort_order)
        VALUES (?,?,?,?,'enum',?,?,?)`,
      ).run(
        id,
        labelName,
        input.scope,
        gatedTypeIds[0] ?? null,
        input.cardinality,
        input.quickFilter ? 1 : 0,
        input.sortOrder ?? 0,
      );
      this.replaceLabelTypes(db, id, gatedTypeIds);
    });
    return this.label(id);
  }

  async updateLabel(
    id: string,
    input: UpdateLabelInput,
  ): Promise<LabelDefinition> {
    await this.database.write((db) => {
      const old = db.prepare('SELECT * FROM labels WHERE id=?').get(id) as
        | {
            name: string;
            scope: 'universal' | 'type';
            gated_type_id: string | null;
            cardinality: 'single' | 'multi';
            quick_filter: number;
            sort_order: number;
          }
        | undefined;
      if (!old) throw new Error('Label not found');
      const labelName = input.name === undefined ? old.name : name(input.name);
      this.assertUniqueLabelName(db, labelName, id);
      const scope = input.scope ?? old.scope;
      const gatedTypeIds =
        scope === 'type'
          ? input.gatedTypeIds === undefined
            ? this.labelTypeIds(db, id)
            : uniqueTypeIds(input.gatedTypeIds)
          : [];
      const cardinality = input.cardinality ?? old.cardinality;
      this.validateLabel(db, scope, gatedTypeIds, cardinality);
      if (scope === 'type') {
        const assignedTypes = db
          .prepare(
            `SELECT DISTINCT t.type_id FROM todo_labels tl
            JOIN todos t ON t.id=tl.todo_id WHERE tl.label_id=?`,
          )
          .all(id) as Array<{ type_id: string }>;
        if (assignedTypes.some((item) => !gatedTypeIds.includes(item.type_id)))
          throw new Error('Label is assigned to todos of another task type');
      }
      if (cardinality === 'single') {
        const multiple = db
          .prepare(
            `SELECT todo_id FROM todo_labels WHERE label_id=?
          GROUP BY todo_id HAVING COUNT(*)>1 LIMIT 1`,
          )
          .get(id);
        if (multiple)
          throw new Error('Some todos have multiple values for this label');
      }
      db.prepare(
        `UPDATE labels SET name=?,scope=?,gated_type_id=?,cardinality=?,quick_filter=?,sort_order=?
        WHERE id=?`,
      ).run(
        labelName,
        scope,
        gatedTypeIds[0] ?? null,
        cardinality,
        input.quickFilter === undefined
          ? old.quick_filter
          : input.quickFilter
            ? 1
            : 0,
        input.sortOrder ?? old.sort_order,
        id,
      );
      this.replaceLabelTypes(db, id, gatedTypeIds);
    });
    return this.label(id);
  }

  async deleteLabel(id: string): Promise<void> {
    await this.database.write((db) => {
      try {
        const result = db.prepare('DELETE FROM labels WHERE id=?').run(id);
        if (!result.changes) throw new Error('Label not found');
      } catch (error) {
        if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
          throw new Error('Label is in use and cannot be deleted');
        }
        throw error;
      }
    });
  }

  async createValue(input: CreateLabelValueInput): Promise<LabelValue> {
    const id = randomUUID();
    await this.database.write((db) => {
      if (!db.prepare('SELECT 1 FROM labels WHERE id=?').get(input.labelId))
        throw new Error('Label not found');
      const value = name(input.value);
      this.assertUniqueValue(db, input.labelId, value);
      db.prepare(
        'INSERT INTO label_values (id,label_id,value,sort_order) VALUES (?,?,?,?)',
      ).run(id, input.labelId, value, input.sortOrder ?? 0);
    });
    return this.value(id);
  }

  async updateValue(
    id: string,
    input: UpdateLabelValueInput,
  ): Promise<LabelValue> {
    await this.database.write((db) => {
      const old = db
        .prepare('SELECT * FROM label_values WHERE id=?')
        .get(id) as
        | { label_id: string; value: string; sort_order: number }
        | undefined;
      if (!old) throw new Error('Label value not found');
      const value = input.value === undefined ? old.value : name(input.value);
      this.assertUniqueValue(db, old.label_id, value, id);
      db.prepare('UPDATE label_values SET value=?,sort_order=? WHERE id=?').run(
        value,
        input.sortOrder ?? old.sort_order,
        id,
      );
    });
    return this.value(id);
  }

  async deleteValue(id: string): Promise<void> {
    await this.database.write((db) => {
      try {
        const result = db
          .prepare('DELETE FROM label_values WHERE id=?')
          .run(id);
        if (!result.changes) throw new Error('Label value not found');
      } catch (error) {
        if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
          throw new Error('Label value is in use and cannot be deleted');
        }
        throw error;
      }
    });
  }

  private assertUniqueValue(
    db: Database.Database,
    labelId: string,
    value: string,
    excludeId?: string,
  ): void {
    const existing = db
      .prepare('SELECT id,value FROM label_values WHERE label_id=?')
      .all(labelId) as Array<{ id: string; value: string }>;
    const duplicate = existing.some(
      (candidate) =>
        candidate.id !== excludeId &&
        comparableValue(candidate.value) === comparableValue(value),
    );
    if (duplicate)
      throw new Error('Label values must be unique, regardless of case');
  }

  private assertUniqueLabelName(
    db: Database.Database,
    labelName: string,
    excludeId?: string,
  ): void {
    const labels = db.prepare('SELECT id,name FROM labels').all() as Array<{
      id: string;
      name: string;
    }>;
    const duplicate = labels.some(
      (label) =>
        label.id !== excludeId &&
        comparableValue(label.name) === comparableValue(labelName),
    );
    if (duplicate)
      throw new Error('Label names must be unique, regardless of case');
  }

  private assertUniqueTypeName(
    db: Database.Database,
    typeName: string,
    excludeId?: string,
  ): void {
    const types = db.prepare('SELECT id,name FROM types').all() as Array<{
      id: string;
      name: string;
    }>;
    const duplicate = types.some(
      (type) =>
        type.id !== excludeId &&
        comparableValue(type.name) === comparableValue(typeName),
    );
    if (duplicate)
      throw new Error('Task type names must be unique, regardless of case');
  }

  private type(id: string): TodoType {
    const row = this.database.db
      .prepare('SELECT id,name,emoji,sort_order FROM types WHERE id=?')
      .get(id) as
      | { id: string; name: string; emoji: string; sort_order: number }
      | undefined;
    if (!row) throw new Error('Type not found');
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      sortOrder: row.sort_order,
    };
  }

  private label(id: string): LabelDefinition {
    const result = this.list().labels.find((item) => item.id === id);
    if (!result) throw new Error('Label not found');
    return result;
  }

  private value(id: string): LabelValue {
    for (const label of this.list().labels) {
      const result = label.values.find((item) => item.id === id);
      if (result) return result;
    }
    throw new Error('Label value not found');
  }

  private validateLabel(
    db: Database.Database,
    scope: string,
    gatedTypeIds: string[],
    cardinality: string,
  ): void {
    if (!['universal', 'type'].includes(scope))
      throw new Error('Invalid label scope');
    if (!['single', 'multi'].includes(cardinality))
      throw new Error('Invalid label cardinality');
    if (scope === 'type' && gatedTypeIds.length === 0)
      throw new Error('A type-scoped label requires at least one task type');
    if (
      gatedTypeIds.some(
        (typeId) => !db.prepare('SELECT 1 FROM types WHERE id=?').get(typeId),
      )
    )
      throw new Error('A type-scoped label includes an invalid task type');
  }

  private labelTypeIds(db: Database.Database, labelId: string): string[] {
    return (
      db
        .prepare('SELECT type_id FROM label_types WHERE label_id=?')
        .all(labelId) as Array<{ type_id: string }>
    ).map((item) => item.type_id);
  }

  private replaceLabelTypes(
    db: Database.Database,
    labelId: string,
    typeIds: string[],
  ): void {
    db.prepare('DELETE FROM label_types WHERE label_id=?').run(labelId);
    const insert = db.prepare(
      'INSERT INTO label_types (label_id,type_id) VALUES (?,?)',
    );
    for (const typeId of typeIds) insert.run(labelId, typeId);
  }
}
