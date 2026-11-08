import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly events: EventEmitter2,
    private readonly guard: LoginGuardService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Log in',
    description: 'Exchange a username and password for a JWT. Rate limited to 5 attempts per minute per IP; 5 failures for one username from one IP within 15 minutes lock that pair for 15 minutes (429). The error never reveals whether the username exists.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiResponse({ status: 401, type: ErrorDto, description: 'Invalid username or password' })
  @ApiResponse({ status: 429, type: ErrorDto, description: 'Too many login attempts' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const meta = { username: dto.username, ip: req.ip, userAgent: req.get('user-agent') };
    this.guard.assertNotLocked(dto.username, req.ip);
    try {
      const result = await this.auth.login(dto.username, dto.password);
      this.guard.recordSuccess(dto.username, req.ip);
      this.events.emit(AppEvents.LoginSucceeded, meta);
      return result;
    } catch (err) {
      if (err instanceof LoginFailedException) {
        const { count, locked } = this.guard.recordFailure(dto.username, req.ip);
        this.events.emit(AppEvents.LoginFailed, { ...meta, reason: err.reason, attempt: count, maxAttempts: MAX_FAILURES, locked });
      }
      throw err;
    }
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
