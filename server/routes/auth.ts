import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  clearSession,
  hashPassword,
  issueSession,
  requireStudent,
  verifyPassword,
} from '../auth';
import { db } from '../db';
import { asyncHandler, HttpError } from '../errors';
import { loadStudents } from '../queries';

export const authRouter = Router();

/**
 * Counts only FAILED logins, per person and per network address. A whole class logging in
 * from one college Wi-Fi does not hit the limit, but guessing one account's password does.
 */
function failedLoginLimiter(field: 'rollNumber' | 'email') {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.[field] ?? '')
        .toLowerCase()
        .slice(0, 80)}`,
    handler: (_req, res) =>
      res.status(429).json({
        error: 'Too many failed attempts. Please wait 15 minutes and try again.',
        code: 'RATE_LIMITED',
      }),
  });
}

const BAD_CREDENTIALS = 'Invalid roll number or password. Please verify your credentials and try again.';

// ------------------------------------------------------------- student

const studentLoginSchema = z.object({
  rollNumber: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(200),
});

authRouter.post(
  '/student/login',
  failedLoginLimiter('rollNumber'),
  asyncHandler(async (req, res) => {
    const { rollNumber, password } = studentLoginSchema.parse(req.body);
    const { rows } = await db.query<{ id: string; password_hash: string; must_change_password: boolean }>(
      `select id, password_hash, must_change_password from students where roll_number = $1`,
      [rollNumber.toUpperCase()]
    );
    const row = rows[0];
    if (!(await verifyPassword(password, row?.password_hash))) {
      throw new HttpError(401, BAD_CREDENTIALS, 'BAD_CREDENTIALS');
    }
    issueSession(res, 'student', row.id);
    const [student] = await loadStudents('s.id = $1', [row.id]);
    res.json({ student, mustChangePassword: row.must_change_password });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(72),
});

authRouter.post(
  '/student/change-password',
  requireStudent,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const id = req.student!.id;

    const { rows } = await db.query<{ password_hash: string }>(
      `select password_hash from students where id = $1`,
      [id]
    );
    if (!(await verifyPassword(currentPassword, rows[0]?.password_hash))) {
      throw new HttpError(400, 'Current password is incorrect.', 'BAD_CURRENT_PASSWORD');
    }
    if (newPassword === currentPassword) {
      throw new HttpError(400, 'New password must be different from your temporary password.');
    }

    await db.query(
      `update students
          set password_hash = $2, must_change_password = false, updated_at = now()
        where id = $1`,
      [id, await hashPassword(newPassword)]
    );
    issueSession(res, 'student', id);
    const [student] = await loadStudents('s.id = $1', [id]);
    res.json({ student });
  })
);

authRouter.post('/student/logout', (_req, res) => {
  clearSession(res, 'student');
  res.json({ ok: true });
});

// --------------------------------------------------------------- admin

const adminLoginSchema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

authRouter.post(
  '/admin/login',
  failedLoginLimiter('email'),
  asyncHandler(async (req, res) => {
    const { email, password } = adminLoginSchema.parse(req.body);
    const { rows } = await db.query(
      `select id, email, name, role, course, designation, password_hash
         from admins where lower(email) = lower($1)`,
      [email]
    );
    const row = rows[0];
    if (!(await verifyPassword(password, row?.password_hash))) {
      throw new HttpError(401, 'Invalid staff email or password.', 'BAD_CREDENTIALS');
    }
    issueSession(res, 'admin', row.id);
    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      course: row.course ?? undefined,
      designation: row.designation,
    });
  })
);

authRouter.post('/admin/logout', (_req, res) => {
  clearSession(res, 'admin');
  res.json({ ok: true });
});
