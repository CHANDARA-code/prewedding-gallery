import { Global, Module } from '@nestjs/common';
import { AlertsListener } from './alerts.listener';
import { AlertsService } from './alerts.service';

@Global()
@Module({
  providers: [AlertsService, AlertsListener],
  exports: [AlertsService],
})
export class AlertsModule {}
