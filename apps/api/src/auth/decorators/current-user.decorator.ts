import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '../../db/schema';
import type { Permission } from '../permissions';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  /** Effective permissions, read fresh from the database on every request. */
  permissions: Permission[];
}

/** The authenticated user, or `null` for guests on optional-auth routes. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | null => {
  return (ctx.switchToHttp().getRequest().user as AuthUser | undefined) ?? null;
});
