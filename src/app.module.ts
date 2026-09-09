import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => process.env] }),
    DatabaseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
