import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DbHandle, openDb, runMigrations } from './client';

export const DRIZZLE = Symbol('DRIZZLE');
export const SQLITE = Symbol('SQLITE');
const HANDLE = Symbol('DB_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: HANDLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DbHandle => {
        const handle = openDb(config.databaseUrl);
        runMigrations(handle);
        return handle;
      },
    },
    { provide: DRIZZLE, inject: [HANDLE], useFactory: (h: DbHandle) => h.db },
    { provide: SQLITE, inject: [HANDLE], useFactory: (h: DbHandle) => h.sqlite },
  ],
  exports: [DRIZZLE, SQLITE],
})
export class DbModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DbModule.name);
  constructor(@Inject(HANDLE) private readonly handle: DbHandle) {}

  onApplicationShutdown() {
    try {
      this.handle.sqlite.pragma('optimize');
      this.handle.sqlite.close();
    } catch (err) {
      this.logger.warn(`DB shutdown: ${(err as Error).message}`);
    }
  }
}
