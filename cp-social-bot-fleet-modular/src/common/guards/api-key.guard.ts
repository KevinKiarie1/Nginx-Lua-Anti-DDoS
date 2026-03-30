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
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
