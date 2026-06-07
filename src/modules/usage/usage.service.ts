import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsageRecord, UsageRecordDocument } from './schemas/usage.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';

@Injectable()
export class UsageService {
  private readonly rateLimitMax: number;
  private readonly rateLimitWindowMs: number;
  private readonly monthlyTokenBudget: number;

  constructor(
    @InjectModel(UsageRecord.name)
    private readonly usageModel: Model<UsageRecordDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {
    this.rateLimitMax = this.configService.get<number>(
      'usage.rateLimitMax',
      10,
    );
    this.rateLimitWindowMs = this.configService.get<number>(
      'usage.rateLimitWindowMs',
      60_000,
    );
    this.monthlyTokenBudget = this.configService.get<number>(
      'usage.monthlyTokenBudget',
      100_000,
    );
  }

  getRateLimitMax(): number {
    return this.rateLimitMax;
  }

  getRateLimitWindowMs(): number {
    return this.rateLimitWindowMs;
  }

  getMonthlyTokenBudget(): number {
    return this.monthlyTokenBudget;
  }

  async getMonthlyTokenUsage(userId: string): Promise<number> {
    const monthStart = this.getMonthStart();

    const result = await this.usageModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          createdAt: { $gte: monthStart },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalTokens' } } },
    ]);

    return result[0]?.total ?? 0;
  }

  async checkTokenBudget(
    userId: string,
    estimatedTokens: number,
  ): Promise<boolean> {
    const used = await this.getMonthlyTokenUsage(userId);
    return used + estimatedTokens <= this.monthlyTokenBudget;
  }

  async recordTokenUsage(
    userId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const totalTokens = inputTokens + outputTokens;
    await this.usageModel.create({
      userId: new Types.ObjectId(userId),
      inputTokens,
      outputTokens,
      totalTokens,
      requestType: 'code_review',
    });

    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { tokenUsage: totalTokens },
    });
  }

  globalTokenUsage() {
    return this.usageModel.aggregate([
      {
        $group: {
          _id: null,
          totalInput: { $sum: '$inputTokens' },
          totalOutput: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
        },
      },
    ]);
  }

  private getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}
