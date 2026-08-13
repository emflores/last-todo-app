export type ReschedulableLane = 'today' | 'week' | 'month' | 'future';

export const RESCHEDULABLE_LANES: readonly ReschedulableLane[] = [
  'today',
  'week',
  'month',
  'future',
];

export function isReschedulableLane(value: string): value is ReschedulableLane {
  return RESCHEDULABLE_LANES.some((lane) => lane === value);
}

export function canMoveBetweenLanes(
  source: string,
  target: string,
): target is ReschedulableLane {
  return (
    source !== target &&
    isReschedulableLane(source) &&
    isReschedulableLane(target)
  );
}

export function proposedDueDate(
  lane: ReschedulableLane,
  today: string,
): string {
  if (lane === 'today') return today;
  if (lane === 'week') return addDays(today, 7);
  if (lane === 'month') return addDays(today, 30);
  return addDays(today, 31);
}

export function dueDateRange(
  lane: ReschedulableLane,
  today: string,
): { min: string; max?: string } {
  if (lane === 'today') return { min: today, max: today };
  if (lane === 'week')
    return { min: addDays(today, 1), max: addDays(today, 7) };
  if (lane === 'month')
    return { min: addDays(today, 8), max: addDays(today, 30) };
  return { min: addDays(today, 31) };
}

export function isDueDateInLane(
  value: string,
  lane: ReschedulableLane,
  today: string,
): boolean {
  const { min, max } = dueDateRange(lane, today);
  return value >= min && (!max || value <= max);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
