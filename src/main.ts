import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`ERP backend listening on http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
