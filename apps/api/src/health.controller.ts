import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

@ApiTags('Health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check', description: 'Liveness probe used by the uptime watchdog.' })
  @ApiOkResponse({ schema: { example: { status: 'ok', uptime: 123.4 } } })
  health(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { status: 'ok', uptime: Math.round(process.uptime() * 10) / 10 };
  }
}
