// ============================================================
// PLATFORM HANDLER INTERFACE
// ============================================================
// Every platform module must implement this interface.
// This is the contract between the task dispatcher and platform
// modules — the ONLY coupling point between them.
//
// MODULAR BOUNDARY: Platform modules register their handler
// with the HandlerRegistryService (in CoreModule). The task
// dispatcher looks up handlers by platform enum value.
// ============================================================

import { Task, Platform } from '@prisma/client';
import { TaskResult } from './task-result.interface';

export interface PlatformHandler {
  /** Which platform this handler serves */
  readonly platform: Platform;

  /** Initialize the handler (connect bots, launch browsers, etc.) */
  initialize(): Promise<void>;

  /** Execute a task and return the result */
  executeTask(task: Task): Promise<TaskResult>;

  /** Clean up resources (close browsers, disconnect bots) */
  shutdown(): Promise<void>;
}
