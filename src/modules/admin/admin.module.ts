import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { ReviewsModule } from '../reviews/reviews.module';
import { UsageModule } from '../usage/usage.module';
import { User, UserSchema } from '../auth/schemas/user.schema';

@Module({
  imports: [
    ReviewsModule,
    UsageModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminController],
})
export class AdminModule {}
