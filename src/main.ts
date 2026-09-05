import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import session from 'express-session';

import { AppModule } from './app.module';
import { Env } from './common/enums/env.enum';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const port = config.getOrThrow<number>('PORT');
  const env = config.getOrThrow<Env>('NODE_ENV');
  const sessionSecret = config.getOrThrow<string>('SESSION_SECRET');

  app.use(cookieParser());

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env === Env.Production,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24,
      },
    })
  );

  await app.listen(port);

  console.log(`Application is running on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
