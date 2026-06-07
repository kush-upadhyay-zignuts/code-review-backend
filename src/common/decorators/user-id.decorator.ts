import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const USER_ID_HEADER = 'x-user-id';

export function resolveUserId(request: Request): string {
  const headerUserId = request.headers[USER_ID_HEADER];
  const userId = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;

  if (userId?.trim()) {
    return userId.trim().slice(0, 128);
  }

  const forwarded = request.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded?.split(',')[0]?.trim() ?? request.ip ?? 'anonymous');

  return ip.slice(0, 128);
}

export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return resolveUserId(request);
  },
);
