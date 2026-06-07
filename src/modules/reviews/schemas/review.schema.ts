import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export interface ReviewIssueResult {
  title: string;
  category: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number | null;
  explanation: string;
  message: string;
  evidence: string;
  suggestedFix: string;
  suggestion: string;
  confidence: number;
}

export interface ReviewMetricsResult {
  codeQualityScore: number;
  securityScore: number;
  maintainabilityScore: number;
}

export interface ReviewResultPayload {
  summary: string;
  overallScore: number;
  metrics: ReviewMetricsResult;
  issues: ReviewIssueResult[];
}

export type ReviewDocument = HydratedDocument<Review>;

@Schema({
  collection: 'reviews',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  language!: string;

  @Prop({ required: true })
  code!: string;

  @Prop({ type: Object, default: null })
  result!: ReviewResultPayload | null;

  @Prop({ default: 0 })
  inputTokens!: number;

  @Prop({ default: 0 })
  outputTokens!: number;

  @Prop({ default: 0 })
  totalTokens!: number;

  @Prop({ default: 0 })
  overallScore!: number;

  @Prop({ default: 0 })
  responseTimeMs!: number;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ userId: 1, createdAt: -1 });
