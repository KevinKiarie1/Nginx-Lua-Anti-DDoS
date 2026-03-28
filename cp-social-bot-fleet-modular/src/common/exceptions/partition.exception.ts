// ============================================================
// CP EXCEPTIONS
// ============================================================
// Custom exceptions for CAP-theorem-related failures.
// When the cluster cannot guarantee consistency, these
// exceptions cause the system to REJECT the operation
// rather than proceed with potentially stale data.
//
// CP Decision: We return 503 Service Unavailable during
// partitions. The client MUST retry later. We never serve
// potentially-inconsistent responses.
// ============================================================

import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when the cluster is partitioned or unhealthy.
 * Returns 503 Service Unavailable — the system is deliberately
 * sacrificing availability to preserve consistency (CP trade-off).
 */
export class PartitionException extends HttpException {
  constructor(
    message = 'Cluster is partitioned or unhealthy. Operation rejected to maintain consistency.',
  ) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Partition',
        message,
        capDecision:
          'CP: Sacrificing availability to maintain consistency during partition.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Thrown when a consistency check fails (e.g., serialization conflict).
 * Returns 409 Conflict — the operation conflicted with a concurrent one.
 */
export class ConsistencyConflictException extends HttpException {
  constructor(message = 'Serialization conflict. Retry the operation.') {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'ConsistencyConflict',
        message,
      },
      HttpStatus.CONFLICT,
    );
  }
}
