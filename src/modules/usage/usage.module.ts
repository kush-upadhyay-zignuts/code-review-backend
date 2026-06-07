import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsageRecord, UsageRecordSchema } from './schemas/usage.schema';
import { UsageService } from './usage.service';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { RedisService } from '../../common/services/redis.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UsageRecord.name, schema: UsageRecordSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [UsageService, RedisService],
  exports: [UsageService, RedisService],
})
export class UsageModule {}
