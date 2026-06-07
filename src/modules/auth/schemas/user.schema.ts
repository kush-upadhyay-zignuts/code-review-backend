import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({
  collection: 'users',
  timestamps: { createdAt: true, updatedAt: true },
})
export class User {
  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ required: true, trim: true })
  lastName!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Prop({ required: true, default: 0 })
  tokenUsage!: number;

  @Prop({ type: String, default: null })
  passwordResetToken?: string | null;

  @Prop({ type: Date, default: null })
  passwordResetExpires?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
