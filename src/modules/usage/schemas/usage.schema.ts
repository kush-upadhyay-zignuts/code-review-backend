import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UsageRecordDocument = HydratedDocument<UsageRecord>;

@Schema({
  collection: 'usage_records',
  timestamps: { createdAt: true, updatedAt: false },
})
export class UsageRecord {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  inputTokens!: number;

  @Prop({ required: true, default: 0 })
  outputTokens!: number;

  @Prop({ required: true, default: 0 })
  totalTokens!: number;

  @Prop({ required: true, default: 'code_review' })
  requestType!: string;
}

export const UsageRecordSchema = SchemaFactory.createForClass(UsageRecord);
UsageRecordSchema.index({ userId: 1, createdAt: -1 });
