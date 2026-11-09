import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request, Response } from 'express';
import { AuthService, LoginFailedException } from './auth.service';
import { LoginGuardService, MAX_FAILURES } from './login-guard.service';
import { LoginDto, LoginResponseDto, UserDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from './decorators/current-user.decorator';
import { ErrorDto } from '../common/photo.dto';
import { AppEvents } from '../alerts/events';
import { APP_CONFIG, AppConfig } from '../config/env';
import { IssuedRefresh, RefreshFailedException, RefreshTokensService } from './refresh-tokens.service';

/** HttpOnly, so page scripts (and anything injected into them) can never read it. */
export const REFRESH_COOKIE = 'pw_refresh';
const COOKIE_PATH = '/api/v1/auth';

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly events: EventEmitter2,
    private readonly guard: LoginGuardService,
    private readonly refreshTokens: RefreshTokensService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setRefreshCookie(res: Response, refresh: IssuedRefresh) {
    res.cookie(REFRESH_COOKIE, refresh.token, {
      httpOnly: true,
      secure: this.config.isProd,
      sameSite: 'lax',
      path: COOKIE_PATH,
      // Without "remember me" it is a browser-session cookie; the server still caps its life.
      ...(refresh.remember ? { expires: refresh.expiresAt } : {}),
    });
  }

  private clearRefreshCookie(res: Response) {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: this.config.isProd, sameSite: 'lax', path: COOKIE_PATH });
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log in',
    description: 'Exchange a username and password for a short-lived JWT access token, and set the HttpOnly `pw_refresh` cookie used by `POST /auth/refresh` to get new access tokens without logging in again. Rate limited to 5 attempts per minute per IP; 5 failures for one username from one IP within 15 minutes lock that pair for 15 minutes (429). The error never reveals whether the username exists.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorDto, description: 'Invalid username or password' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'Too many login attempts' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const meta = { username: dto.username, ip: req.ip, userAgent: req.get('user-agent') };
    this.guard.assertNotLocked(dto.username, req.ip);
    try {
      const { user, response } = await this.auth.login(dto.username, dto.password);
      this.guard.recordSuccess(dto.username, req.ip);
      this.setRefreshCookie(res, this.refreshTokens.issue(user, dto.remember ?? true, req.get('user-agent')));
      this.events.emit(AppEvents.LoginSucceeded, meta);
      return response;
    } catch (err) {
      if (err instanceof LoginFailedException) {
        const { count, locked } = this.guard.recordFailure(dto.username, req.ip);
        this.events.emit(AppEvents.LoginFailed, { ...meta, reason: err.reason, attempt: count, maxAttempts: MAX_FAILURES, locked });
      }
      throw err;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Refresh the session',
    description:
      'Uses the HttpOnly `pw_refresh` cookie set at login to issue a new access token. The cookie is rotated on every call; replaying an already-used refresh token ends that session. Fails (401) after logout, password reset, disabling the account, or when the session has not been used for its lifetime.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorDto, description: 'No valid session; log in again' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const token = readCookie(req, REFRESH_COOKIE);
    try {
      if (!token) throw new RefreshFailedException();
      const { user, refresh } = this.refreshTokens.rotate(token, req.get('user-agent'));
      this.setRefreshCookie(res, refresh);
      return await this.auth.session(user);
    } catch (err) {
      if (err instanceof RefreshFailedException) this.clearRefreshCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Log out', description: 'Ends the session of the `pw_refresh` cookie and clears it. Access tokens already issued stay valid until they expire.' })
  @ApiNoContentResponse()
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req, REFRESH_COOKIE);
    if (token) this.refreshTokens.revoke(token);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user', description: 'Returns the profile of the user that owns the bearer token.' })
  @ApiOkResponse({ type: UserDto })
  @ApiResponse({ status: 401, type: ErrorDto })
  me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.me(user);
  }
}
