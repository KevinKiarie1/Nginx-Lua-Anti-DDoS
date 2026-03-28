// ============================================================
// CONSISTENCY GUARD
// ============================================================
// NestJS guard that checks cluster health before allowing
// request processing. Applied to routes decorated with
// @RequireHealthy(). Returns 503 during partitions.
//
// This enforces CP guarantees at the HTTP boundary — no
// request that requires consistency will execute if the
// cluster cannot guarantee it.
// ============================================================

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_HEALTHY_KEY } from '../../common/decorators/require-healthy.decorator';
import { ConsistencyService } from './consistency.service';

@Injectable()
export class ConsistencyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly consistency: ConsistencyService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requireHealthy = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_HEALTHY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requireHealthy) {
      return true; // No health requirement on this route
    }

    // This will throw PartitionException if unhealthy
    this.consistency.requireHealthy();
    return true;
  }
}
