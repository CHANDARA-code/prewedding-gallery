import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ListQueryDto } from '../common/list-query.dto';
import { ErrorDto, PhotoListDto } from '../common/photo.dto';
import { setNoStore } from '../common/cache-headers';
import { SharesService } from './shares.service';
import { CreateShareDto, MySharesDto, PersonDto, SHARE_TOKEN, ShareDto, UpdateShareDto } from './share.dto';

function signedIn(user: AuthUser | null): AuthUser {
  if (!user) throw new UnauthorizedException('Log in to share photos');
  return user;
}

function token(t: string): string {
  if (!SHARE_TOKEN.test(t)) throw new BadRequestException('Invalid link');
  return t;
}

/**
 * Share links. Creating and managing them needs an account; opening a public one doesn't. Responses
 * are never cached: a link can be made private or deleted at any time.
 */
@ApiTags('Shares')
@ApiBearerAuth()
@Controller()
@UseGuards(OptionalJwtAuthGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get('me/shares')
  @ApiOperation({ summary: 'My share links', description: 'Links you made, private links shared with you, and (admins) everyone else’s.' })
  @ApiOkResponse({ type: MySharesDto })
  @ApiResponse({ status: 401, type: ErrorDto })
  mine(@CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.mine(signedIn(user));
  }

  @Get('shares/people')
  @ApiOperation({ summary: 'People to share with', description: 'Active accounts other than you, by name, for private links.' })
  @ApiOkResponse({ type: [PersonDto] })
  @ApiResponse({ status: 401, type: ErrorDto })
  people(@CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.people(signedIn(user));
  }

  @Post('shares')
  @ApiOperation({
    summary: 'Create a share link',
    description: 'From a selection of photos. `public`: anyone with the link can view. `private`: only `userIds` (signed in), you and admins.',
  })
  @ApiCreatedResponse({ type: ShareDto })
  @ApiResponse({ status: 400, type: ErrorDto })
  @ApiResponse({ status: 401, type: ErrorDto })
  create(@Body() dto: CreateShareDto, @CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.create(signedIn(user), dto);
  }

  @Patch('shares/:id')
  @ApiOperation({ summary: 'Update a share link', description: 'Title, who can open it, or expiry. Its creator or an admin.' })
  @ApiOkResponse({ type: ShareDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShareDto, @CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.update(signedIn(user), id, dto);
  }

  @Delete('shares/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a share link', description: 'The link stops working. The photos are untouched. Its creator or an admin.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 404, type: ErrorDto })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    this.shares.remove(signedIn(user), id);
  }

  @Get('shares/:token')
  @ApiOperation({ summary: 'Open a share link', description: 'Public links: anyone. Private: 401 for guests, 403 for people it was not shared with. Expired: 410.' })
  @ApiOkResponse({ type: ShareDto })
  @ApiResponse({ status: 401, type: ErrorDto })
  @ApiResponse({ status: 403, type: ErrorDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 410, type: ErrorDto })
  get(@Param('token') t: string, @CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.get(token(t), user);
  }

  @Get('shares/:token/photos')
  @ApiOperation({ summary: 'Photos in a share link', description: 'Newest first, cursor-paginated (same shape as `GET /photos`). Same access rules as the link.' })
  @ApiOkResponse({ type: PhotoListDto })
  @ApiResponse({ status: 401, type: ErrorDto })
  @ApiResponse({ status: 403, type: ErrorDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 410, type: ErrorDto })
  photos(@Param('token') t: string, @Query() q: ListQueryDto, @CurrentUser() user: AuthUser | null, @Res({ passthrough: true }) res: Response) {
    setNoStore(res);
    return this.shares.listPhotos(token(t), user, q.limit, q.cursor);
  }
}
