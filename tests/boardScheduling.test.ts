import { describe, expect, it } from 'vitest';
import {
  canMoveBetweenLanes,
  dueDateRange,
  isDueDateInLane,
  proposedDueDate,
} from '../src/shared/boardScheduling';

describe('board drag scheduling', () => {
  const today = '2026-08-12';

  it('permits moves between all non-overdue scheduling lanes', () => {
    expect(canMoveBetweenLanes('today', 'week')).toBe(true);
    expect(canMoveBetweenLanes('week', 'month')).toBe(true);
    expect(canMoveBetweenLanes('month', 'today')).toBe(true);
    expect(canMoveBetweenLanes('today', 'today')).toBe(false);
    expect(canMoveBetweenLanes('today', 'overdue')).toBe(false);
    expect(canMoveBetweenLanes('month', 'future')).toBe(true);
    expect(canMoveBetweenLanes('future', 'month')).toBe(true);
    expect(canMoveBetweenLanes('overdue', 'future')).toBe(false);
  });

  it('proposes the end of the selected scheduling window', () => {
    expect(proposedDueDate('today', today)).toBe('2026-08-12');
    expect(proposedDueDate('week', today)).toBe('2026-08-19');
    expect(proposedDueDate('month', today)).toBe('2026-09-11');
    expect(proposedDueDate('future', today)).toBe('2026-09-12');
  });

  it('constrains edited dates to the selected lane', () => {
    expect(dueDateRange('week', today)).toEqual({
      min: '2026-08-13',
      max: '2026-08-19',
    });
    expect(isDueDateInLane('2026-08-19', 'week', today)).toBe(true);
    expect(isDueDateInLane('2026-08-20', 'week', today)).toBe(false);
    expect(isDueDateInLane('2026-08-20', 'month', today)).toBe(true);
    expect(dueDateRange('future', today)).toEqual({ min: '2026-09-12' });
    expect(isDueDateInLane('2026-09-11', 'future', today)).toBe(false);
    expect(isDueDateInLane('2026-09-12', 'future', today)).toBe(true);
    expect(isDueDateInLane('2030-01-01', 'future', today)).toBe(true);
  });
});
