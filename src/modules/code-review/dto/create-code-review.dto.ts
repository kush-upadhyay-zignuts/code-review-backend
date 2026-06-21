import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'rust',
  'csharp',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'other',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class CreateCodeReviewDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(50_000)
  code!: string;

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: SupportedLanguage;
}

export { SUPPORTED_LANGUAGES };
