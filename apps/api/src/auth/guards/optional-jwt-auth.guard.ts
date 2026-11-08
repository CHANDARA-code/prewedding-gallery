import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Lets guests through (no Authorization header) but populates `req.user` for a valid token.
 * A token that is present but invalid or expired is rejected with 401 so the client can
 * clear its session instead of silently browsing as a guest.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<T>(err: unknown, user: T): T {
    if (err || !user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }
}
