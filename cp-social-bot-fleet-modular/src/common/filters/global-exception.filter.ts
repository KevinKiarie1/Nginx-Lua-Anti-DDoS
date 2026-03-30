// ============================================================
// GLOBAL EXCEPTION FILTER
// ============================================================
// Catches all unhandled exceptions and formats them into a
// consistent JSON response. Logs unexpected errors.
// ============================================================

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
      // Never leak stack traces to clients in production
      message = {
        statusCode: status,
        message:
          process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : exception.message,
      };
    }

    const correlationId = request.headers['x-correlation-id'] as
      | string
      | undefined;

    response.status(status).json({
      ...(typeof message === 'string' ? { message } : message),
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(correlationId ? { correlationId } : {}),
    });
  }
}
