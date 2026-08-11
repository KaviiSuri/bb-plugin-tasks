export const TASK_BLOCKING_FILTERS = [
  "all",
  "blocked",
  "not_blocked",
] as const;

export type TaskBlockingFilter = (typeof TASK_BLOCKING_FILTERS)[number];
