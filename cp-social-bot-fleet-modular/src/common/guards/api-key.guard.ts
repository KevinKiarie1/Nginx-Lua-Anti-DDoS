// ============================================================
// API KEY GUARD
// ============================================================
// Protects API endpoints with a shared API key passed in the
// X-Api-Key header. If no API_KEY is configured, auth is
// disabled (development mode).
// ============================================================

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;
    const expectedKey = this.config.get<string>('app.apiKey');
    const allowUnauthenticated = this.config.get<boolean>(
      'app.allowUnauthenticated',
    );

    if (allowUnauthenticated) {
      return true;
    }

    if (!expectedKey) {
      throw new UnauthorizedException(
        'API authentication is not configured for this deployment',
      );
    }

    if (!apiKey || !this.safeCompare(apiKey, expectedKey)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }

  /** Constant-time comparison to prevent timing-based key extraction. */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // Pad to equal length to avoid leaking key length via timing
    if (bufA.length !== bufB.length) {
      const maxLen = Math.max(bufA.length, bufB.length);
      const paddedA = Buffer.alloc(maxLen);
      const paddedB = Buffer.alloc(maxLen);
      bufA.copy(paddedA);
      bufB.copy(paddedB);
      timingSafeEqual(paddedA, paddedB);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
