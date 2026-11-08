import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ThrottlerException } from '@nestjs/throttler';
import { STATUS_CODES } from 'http';
import type { Request, Response } from 'express';
import { AppEvents } from '../alerts/events';

/** Normalises every error to `{ statusCode, error, message }` and raises alerts for 5xx. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');
  constructor(private readonly events: EventEmitter2) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: unknown }).message ?? exception.message;
      message = Array.isArray(raw) ? raw.join('; ') : String(raw);
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Request body too large';
    } else if ((exception as { type?: string })?.type === 'entity.parse.failed') {
      status = HttpStatus.BAD_REQUEST;
      message = 'Malformed JSON body';
    }

    if (exception instanceof ThrottlerException) {
      message = 'Too many requests, please slow down';
      if (req.path.endsWith('/auth/login')) {
        this.events.emit(AppEvents.LoginThrottled, { username: '', ip: req.ip });
      }
    }

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`${req.method} ${req.originalUrl}: ${err?.message}`, err?.stack);
      this.events.emit(AppEvents.AppError, {
        method: req.method,
        path: req.originalUrl,
        status,
        message: err?.message ?? String(exception),
        stack: err?.stack,
      });
    }

    if (res.headersSent) return;
    res.status(status).json({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', message });
  }
}
