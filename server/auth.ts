import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, RequestHandler, Response } from 'express';
import { config } from './config';
import { db } from './db';
import { asyncHandler, HttpError } from './errors';

export type SessionKind = 'student' | 'admin';

const COOKIE_NAME: Record<SessionKind, string> = {
  student: 'sies_student',
  admin: 'sies_admin',
};

export interface StudentSessionRow {
  id: string;
  roll_number: string;
  name: string;
  class_id: string;
  semester: string;
  attendance_percent: number;
  must_change_password: boolean;
}

export interface AdminSessionRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'hod';
  course: string | null;
  designation: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      student?: StudentSessionRow;
      admin?: AdminSessionRow;
    }
  }
}

// ---------- passwords ----------

const BCRYPT_ROUNDS = 10;
// Compared against when the account does not exist, so a wrong roll number and a wrong
// password take the same time and give the same answer.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}

// ---------- session cookies ----------

export function issueSession(res: Response, kind: SessionKind, id: string) {
  const hours = kind === 'student' ? config.studentSessionHours : config.adminSessionHours;
  const token = jwt.sign({ sub: id, kind }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${hours}h`,
  });
  res.cookie(COOKIE_NAME[kind], token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: hours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response, kind: SessionKind) {
  res.clearCookie(COOKIE_NAME[kind], {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
  });
}

function readSessionId(req: Request, kind: SessionKind): string | null {
  const token = req.cookies?.[COOKIE_NAME[kind]];
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (payload.kind !== kind || typeof payload.sub !== 'string') return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// ---------- middleware ----------

/** Student must be logged in. The student is looked up fresh on every request. */
export const requireStudent: RequestHandler = asyncHandler(async (req, _res, next) => {
  const id = readSessionId(req, 'student');
  if (!id) throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');

  const { rows } = await db.query<StudentSessionRow>(
    `select id, roll_number, name, class_id, semester, attendance_percent, must_change_password
       from students where id = $1`,
    [id]
  );
  if (rows.length === 0) throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
  req.student = rows[0];
  next();
});

/** Like requireStudent, but also refuses students who still have the temporary password. */
export const requireActiveStudent: RequestHandler = (req, res, next) => {
  requireStudent(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.student?.must_change_password) {
      return next(
        new HttpError(403, 'Please change your temporary password before continuing.', 'PASSWORD_CHANGE_REQUIRED')
      );
    }
    next();
  });
};

async function loadAdmin(req: Request): Promise<AdminSessionRow> {
  const id = readSessionId(req, 'admin');
  if (!id) throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
  const { rows } = await db.query<AdminSessionRow>(
    `select id, email, name, role, course, designation from admins where id = $1`,
    [id]
  );
  if (rows.length === 0) throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
  return rows[0];
}

/** Any staff login: admin or HOD. */
export const requireStaff: RequestHandler = asyncHandler(async (req, _res, next) => {
  req.admin = await loadAdmin(req);
  next();
});

/** Full administrators only. HODs are refused. */
export const requireAdmin: RequestHandler = asyncHandler(async (req, _res, next) => {
  const admin = await loadAdmin(req);
  if (admin.role !== 'admin') {
    throw new HttpError(403, 'Only administrators can do this.', 'FORBIDDEN');
  }
  req.admin = admin;
  next();
});
