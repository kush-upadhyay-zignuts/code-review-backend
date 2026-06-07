import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Review,
  ReviewDocument,
  ReviewResultPayload,
} from './schemas/review.schema';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
  ) {}

  createPending(userId: string, language: string, code: string) {
    return this.reviewModel.create({
      userId: new Types.ObjectId(userId),
      language,
      code,
      result: null,
    });
  }

  async saveResult(
    reviewId: string,
    result: ReviewResultPayload,
    metrics: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      responseTimeMs: number;
    },
  ) {
    return this.reviewModel.findByIdAndUpdate(
      reviewId,
      {
        result,
        overallScore: result.overallScore,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        totalTokens: metrics.totalTokens,
        responseTimeMs: metrics.responseTimeMs,
      },
      { new: true },
    );
  }

  findByUser(userId: string, limit = 20) {
    return this.reviewModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-code')
      .lean();
  }

  findByIdForUser(reviewId: string, userId: string) {
    return this.reviewModel
      .findOne({
        _id: new Types.ObjectId(reviewId),
        userId: new Types.ObjectId(userId),
      })
      .lean();
  }

  async deleteForUser(reviewId: string, userId: string) {
    return this.reviewModel.deleteOne({
      _id: new Types.ObjectId(reviewId),
      userId: new Types.ObjectId(userId),
    });
  }

  countByUser(userId: string) {
    return this.reviewModel.countDocuments({
      userId: new Types.ObjectId(userId),
    });
  }

  aggregateUserStats(userId: string) {
    return this.reviewModel.aggregate([
      { $match: { userId: new Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          avgScore: { $avg: '$overallScore' },
          avgResponseTime: { $avg: '$responseTimeMs' },
        },
      },
    ]);
  }

  languageBreakdown(userId: string) {
    return this.reviewModel.aggregate([
      { $match: { userId: new Types.ObjectId(userId) } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
  }

  globalStats() {
    return this.reviewModel.aggregate([
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          totalTokens: { $sum: '$totalTokens' },
          avgScore: { $avg: '$overallScore' },
          avgResponseTime: { $avg: '$responseTimeMs' },
        },
      },
    ]);
  }
}
