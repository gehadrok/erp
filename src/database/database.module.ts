import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_DATA_SOURCE, RuntimeDatabaseService } from './connection.factory';

@Global()
@Module({
  providers: [
    {
      provide: APP_DATA_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        url: config.get<string>('APP_DATABASE_URL') ?? config.get<string>('DATABASE_URL')!,
      }),
    },
    RuntimeDatabaseService,
  ],
  exports: [RuntimeDatabaseService],
})
export class DatabaseModule {}
