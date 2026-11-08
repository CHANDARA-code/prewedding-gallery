import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DRIZZLE } from '../db/db.module';
import type { Db } from '../db/client';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { AppEvents } from '../alerts/events';
import * as core from './users.core';
import type { CreateUserDto, UpdateUserDto } from './users.dto';

/** Maps the shared rule errors onto HTTP exceptions. */
function http<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw mapError(err);
  }
}
function mapError(err: unknown): unknown {
  if (!(err instanceof core.UserRuleError)) return err;
  switch (err.kind) {
    case 'not_found':
      return new NotFoundException(err.message);
    case 'conflict':
      return new ConflictException(err.message);
    case 'forbidden':
      return new ForbiddenException(err.message);
    default:
      return new BadRequestException(err.message);
  }
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly events: EventEmitter2,
  ) {}

  list() {
    return core.listUsers(this.db);
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const result = await core.createUser(this.db, dto).catch((e) => Promise.reject(mapError(e)));
    this.events.emit(AppEvents.UserChanged, { actor, target: result.user.username, change: `created (${describe(result.user)})` });
    return result;
  }

  update(actor: AuthUser, id: number, dto: UpdateUserDto) {
    const before = http(() => core.getUser(this.db, id));
    const user = http(() => core.updateUser(this.db, actor.id, id, dto));
    const changes: string[] = [];
    if (before.role !== user.role) changes.push(`role ${before.role} → ${user.role}`);
    if (before.grants.join() !== user.grants.join()) changes.push(`grants: ${user.grants.join(', ') || 'none'}`);
    if (before.disabled !== user.disabled) changes.push(user.disabled ? 'disabled' : 'enabled');
    if (changes.length) this.events.emit(AppEvents.UserChanged, { actor, target: user.username, change: changes.join('; ') });
    return user;
  }

  async resetPassword(actor: AuthUser, id: number, password?: string) {
    const result = await core.resetPassword(this.db, id, password).catch((e) => Promise.reject(mapError(e)));
    this.events.emit(AppEvents.UserChanged, { actor, target: result.user.username, change: 'password reset, signed out everywhere' });
    return result;
  }

  remove(actor: AuthUser, id: number) {
    const user = http(() => core.deleteUser(this.db, actor.id, id));
    this.events.emit(AppEvents.UserChanged, { actor, target: user.username, change: 'deleted' });
  }
}

function describe(u: core.UserView) {
  return u.role === 'admin' ? 'admin' : `user${u.grants.length ? ` + ${u.grants.join(', ')}` : ''}`;
}
