// ============================================================
// TASK RESULT INTERFACE
// ============================================================
// Standardized result type returned by all platform handlers.
// Every executeTask() call returns this shape.
// ============================================================

export interface TaskResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
