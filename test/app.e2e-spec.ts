import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('CodeReview (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(() => {
    process.env.MONGODB_URL =
      process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017/code_review_test';
    process.env.AI_API_KEY = process.env.AI_API_KEY ?? 'test-key';
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 30_000);

  afterEach(async () => {
    await app?.close();
  });

  it('rejects invalid payload', () => {
    return request(app.getHttpServer())
      .post('/api/code-review/stream')
      .send({ code: '', language: 'invalid-lang' })
      .expect(400);
  });
});
