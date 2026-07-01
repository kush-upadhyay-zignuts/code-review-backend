import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCodeReviewDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50_000)
  code!: string;

  /** Optional hint — when omitted the AI auto-detects any programming language. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  language?: string;
}
