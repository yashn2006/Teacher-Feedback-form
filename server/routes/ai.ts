import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { generateQuestions } from '../ai';
import { requireAdmin } from '../auth';
import { asyncHandler } from '../errors';

export const aiRouter = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many question requests this hour. Please try again later.', code: 'RATE_LIMITED' }),
});

const bodySchema = z.object({
  className: z.string().trim().max(100).optional(),
  semester: z.string().trim().max(30).optional(),
  course: z.string().trim().max(100).optional(),
  academicYear: z.string().trim().max(20).optional(),
});

// Admin only: every call can cost money, so it is never open to students or the public.
aiRouter.post(
  '/generate-questions',
  requireAdmin,
  aiLimiter,
  asyncHandler(async (req, res) => {
    const params = bodySchema.parse(req.body ?? {});
    res.json(await generateQuestions(params));
  })
);
