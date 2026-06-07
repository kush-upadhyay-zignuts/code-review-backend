import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig, {
  aiConfig,
  databaseConfig,
  emailConfig,
  jwtConfig,
  redisConfig,
  usageConfig,
} from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        redisConfig,
        aiConfig,
        usageConfig,
        emailConfig,
      ],
      envFilePath: ['.env.local', '.env'],
    }),
  ],
})
export class AppConfigModule {}
