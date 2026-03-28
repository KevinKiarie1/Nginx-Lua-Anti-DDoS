// ============================================================
// @RequireHealthy() DECORATOR
// ============================================================
// Method decorator that marks a controller endpoint as requiring
// a healthy cluster before execution. Used with ConsistencyGuard.
//
// If the cluster is not healthy, the guard throws a
// PartitionException (503) — enforcing CP guarantees at the
// API boundary.
// ============================================================

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_HEALTHY_KEY = 'requireHealthy';

/**
 * Marks a controller endpoint as requiring a healthy cluster.
 * The ConsistencyGuard checks this metadata and rejects
 * requests during network partitions.
 */
export const RequireHealthy = () => SetMetadata(REQUIRE_HEALTHY_KEY, true);
