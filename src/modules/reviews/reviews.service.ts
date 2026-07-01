import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Review,
  ReviewDocument,
  ReviewResultPayload,
} from './schemas/review.schema';
import { isPlaceholderLanguage, normalizeDetectedLanguage } from '../code-review/language-utils';

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
    detectedLanguage?: string,
  ) {
    const updateData: any = {
      result,
      overallScore: result.overallScore,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      totalTokens: metrics.totalTokens,
      responseTimeMs: metrics.responseTimeMs,
    };

    if (detectedLanguage) {
      const normalized = normalizeDetectedLanguage(detectedLanguage);
      if (normalized && !isPlaceholderLanguage(normalized)) {
        updateData.language = normalized;
      }
    }

    return this.reviewModel.findByIdAndUpdate(
      reviewId,
      updateData,
      { new: true },
    );
  }

  async findByUserPaginated(userId: string, page = 1, limit = 10) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;
    const filter = { userId: new Types.ObjectId(userId) };

    const [items, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .select('-code')
        .lean(),
      this.reviewModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
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
      {
        $match: {
          userId: new Types.ObjectId(userId),
          language: { $nin: ['auto', 'auto-detected', '', null] },
        },
      },
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
