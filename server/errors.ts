import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an id coming from the URL and returns it. */
export function idParam(value: unknown): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(400, 'That id is not valid.');
  }
  return value;
}

/** Lets async route handlers throw without a try/catch. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
    return res.status(400).json({
      error: `${issue?.message ?? 'Invalid request'}${where}`,
      code: 'VALIDATION',
    });
  }

  // body-parser problems
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The request is too large.' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }

  // Postgres problems that are the caller's fault
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'That record already exists.', code: 'DUPLICATE' });
  }
  if (err?.code === '23503') {
    return res.status(409).json({
      error: 'This item is in use (it has students, forms or feedback attached), so it cannot be changed or removed.',
      code: 'IN_USE',
    });
  }
  if (err?.code === '22P02') {
    return res.status(400).json({ error: 'That id is not valid.' });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
