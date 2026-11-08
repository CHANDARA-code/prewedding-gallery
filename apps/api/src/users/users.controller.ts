import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ErrorDto } from '../common/photo.dto';
import { setNoStore } from '../common/cache-headers';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  PERMISSION_INFO,
  PermissionInfoDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserAdminDto,
  UserWithPasswordDto,
} from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@ApiResponse({ status: 401, type: ErrorDto, description: 'Missing or invalid token' })
@ApiResponse({ status: 403, type: ErrorDto, description: 'Not an admin, or a self-lockout / last-admin rule was hit' })
@Controller('admin/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('users.manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Permission catalogue', description: 'Every permission with a label. Admins have all of them; `grantable` ones can be given to a user role.' })
  @ApiOkResponse({ type: [PermissionInfoDto] })
  permissions() {
    return PERMISSION_INFO;
  }

  @Get()
  @ApiOperation({ summary: 'List users', description: 'Admins first, then by username.' })
  @ApiOkResponse({ type: [UserAdminDto] })
  list(@Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.users.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create user', description: 'Creates an account with a role and optional extra permissions. Omit `password` to get a generated one back (shown once).' })
  @ApiCreatedResponse({ type: UserWithPasswordDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'Username taken' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.users.create(actor, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update role, permissions or status',
    description: 'Changes apply to the user’s next request. Disabling signs them out everywhere. You cannot demote or disable yourself, and there must always be one active admin.',
  })
  @ApiOkResponse({ type: UserAdminDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.users.update(actor, id, dto);
  }

  @Post(':id/password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset password', description: 'Sets the given password, or generates one when omitted (returned once). Signs the user out of every device.' })
  @ApiOkResponse({ type: UserWithPasswordDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.users.resetPassword(actor, id, dto.password);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete user', description: 'Deletes the account with its favorites and saves. Accounts that uploaded photos can only be disabled (409).' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 409, type: ErrorDto, description: 'User has uploaded photos' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthUser, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    this.users.remove(actor, id);
  }
}
