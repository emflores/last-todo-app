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
      value_kind: 'enum' | 'user_managed';
      cardinality: 'single' | 'multi';
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
        gatedTypeId: label.gated_type_id,
        valueKind: label.value_kind,
        cardinality: label.cardinality,
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
    await this.database.write((db) =>
      db
        .prepare(
          'INSERT INTO types (id,name,emoji,sort_order) VALUES (?,?,?,?)',
        )
        .run(id, name(input.name), emoji(input.emoji), input.sortOrder ?? 0),
    );
    return this.type(id);
  }

  async updateType(id: string, input: UpdateTypeInput): Promise<TodoType> {
    await this.database.write((db) => {
      const old = db.prepare('SELECT * FROM types WHERE id=?').get(id) as
        | { name: string; emoji: string; sort_order: number }
        | undefined;
      if (!old) throw new Error('Type not found');
      db.prepare('UPDATE types SET name=?,emoji=?,sort_order=? WHERE id=?').run(
        input.name === undefined ? old.name : name(input.name),
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
      this.validateLabel(db, input.scope, input.gatedTypeId, input.cardinality);
      db.prepare(
        `INSERT INTO labels
        (id,name,scope,gated_type_id,value_kind,cardinality,sort_order) VALUES (?,?,?,?,?,?,?)`,
      ).run(
        id,
        name(input.name),
        input.scope,
        input.scope === 'type' ? input.gatedTypeId : null,
        input.valueKind,
        input.cardinality,
        input.sortOrder ?? 0,
      );
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
            value_kind: 'enum' | 'user_managed';
            cardinality: 'single' | 'multi';
            sort_order: number;
          }
        | undefined;
      if (!old) throw new Error('Label not found');
      const scope = input.scope ?? old.scope;
      const gatedTypeId =
        scope === 'type'
          ? input.gatedTypeId === undefined
            ? old.gated_type_id
            : input.gatedTypeId
          : null;
      const cardinality = input.cardinality ?? old.cardinality;
      this.validateLabel(db, scope, gatedTypeId, cardinality);
      if (scope === 'type') {
        const incompatible = db
          .prepare(
            `SELECT 1 FROM todo_labels tl JOIN todos t ON t.id=tl.todo_id
          WHERE tl.label_id=? AND t.type_id<>? LIMIT 1`,
          )
          .get(id, gatedTypeId);
        if (incompatible)
          throw new Error('Label is assigned to todos of another type');
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
        `UPDATE labels SET name=?,scope=?,gated_type_id=?,value_kind=?,cardinality=?,sort_order=?
        WHERE id=?`,
      ).run(
        input.name === undefined ? old.name : name(input.name),
        scope,
        gatedTypeId,
        input.valueKind ?? old.value_kind,
        cardinality,
        input.sortOrder ?? old.sort_order,
        id,
      );
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
      db.prepare(
        'INSERT INTO label_values (id,label_id,value,sort_order) VALUES (?,?,?,?)',
      ).run(id, input.labelId, name(input.value), input.sortOrder ?? 0);
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
        .get(id) as { value: string; sort_order: number } | undefined;
      if (!old) throw new Error('Label value not found');
      db.prepare('UPDATE label_values SET value=?,sort_order=? WHERE id=?').run(
        input.value === undefined ? old.value : name(input.value),
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
    gatedTypeId: string | null | undefined,
    cardinality: string,
  ): void {
    if (!['universal', 'type'].includes(scope))
      throw new Error('Invalid label scope');
    if (!['single', 'multi'].includes(cardinality))
      throw new Error('Invalid label cardinality');
    if (
      scope === 'type' &&
      (!gatedTypeId ||
        !db.prepare('SELECT 1 FROM types WHERE id=?').get(gatedTypeId))
    ) {
      throw new Error('A type-scoped label requires a valid type');
    }
  }
}
