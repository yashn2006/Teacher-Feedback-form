import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { hashPassword, requireAdmin } from '../auth';
import { db } from '../db';
import { asyncHandler, HttpError, idParam, UUID_RE } from '../errors';
import { expectedAssignments, loadForms, loadStudents, round1, type Queryable } from '../queries';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---------------------------------------------------------------- helpers

const uuid = z.string().regex(UUID_RE, 'That id is not valid.');
const yearString = z.string().regex(/^\d{4}-\d{2}$/, 'Academic year must look like 2026-27.');
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-11-25.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'That is not a real date.');
const LEVELS = ['FY', 'SY', 'TY', 'PG-I', 'PG-II'] as const;

/** Turns a foreign-key failure (code 23503) into a clear message. */
async function withInUseMessage<T>(message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === '23503') throw new HttpError(409, message, 'IN_USE');
    throw err;
  }
}

/** Turns a duplicate-key failure (code 23505) into a clear message. */
async function withDuplicateMessage<T>(message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.code === '23505') throw new HttpError(409, message, 'DUPLICATE');
    throw err;
  }
}

const classJson = (r: any) => ({
  id: r.id,
  name: r.name,
  level: r.level,
  course: r.course,
  division: r.division,
  semesters: r.semesters,
});
const subjectJson = (r: any) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  classId: r.class_id,
  semester: r.semester,
  credits: r.credits,
});
const teacherJson = (r: any) => ({
  id: r.id,
  employeeCode: r.employee_code,
  name: r.name,
  department: r.department,
  designation: r.designation,
  email: r.email,
  active: r.active,
});

async function requireClass(id: string, q: Queryable = db) {
  const { rows } = await q.query(`select * from classes where id = $1`, [id]);
  if (rows.length === 0) throw new HttpError(404, 'Selected class was not found.');
  return rows[0];
}

// --------------------------------------------------------------- overview

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `select (select count(*) from classes)::int                    as total_classes,
              (select count(*) from teachers where active)::int      as total_teachers,
              (select count(*) from students)::int                   as total_students,
              (select count(*) from forms where status = 'open')::int as open_forms`
    );
    const forms = await loadForms('');
    const eligible = forms.reduce((n, f) => n + f.eligibleCount, 0);
    const submitted = forms.reduce((n, f) => n + f.submittedCount, 0);
    res.json({
      totalClasses: rows[0].total_classes,
      totalTeachers: rows[0].total_teachers,
      totalStudents: rows[0].total_students,
      openFormsCount: rows[0].open_forms,
      overallResponseRate: eligible > 0 ? round1((submitted / eligible) * 100) : 0,
      recentForms: forms,
    });
  })
);

// ------------------------------------------------------ classes & subjects

adminRouter.get(
  '/classes',
  asyncHandler(async (_req, res) => {
    const classes = await db.query(`select * from classes order by level, name`);
    const subjects = await db.query(`select * from subjects order by code`);
    res.json({ classes: classes.rows.map(classJson), subjects: subjects.rows.map(subjectJson) });
  })
);

const classSchema = z.object({
  name: z.string().trim().min(2).max(100),
  level: z.enum(LEVELS),
  course: z.string().trim().min(2).max(100),
  division: z.string().trim().min(1).max(10).default('A'),
  semesters: z.array(z.string().trim().min(1).max(30)).min(1).max(8),
});

adminRouter.post(
  '/classes',
  asyncHandler(async (req, res) => {
    const body = classSchema.parse(req.body);
    const { rows } = await withDuplicateMessage('A class with that name already exists.', () =>
      db.query(
        `insert into classes (name, level, course, division, semesters)
         values ($1, $2, $3, $4, $5) returning *`,
        [body.name, body.level, body.course, body.division, body.semesters]
      )
    );
    res.status(201).json(classJson(rows[0]));
  })
);

adminRouter.delete(
  '/classes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const result = await withInUseMessage(
      'This class has students, forms or feedback attached, so it cannot be deleted.',
      () => db.query(`delete from classes where id = $1`, [id])
    );
    if (result.rowCount === 0) throw new HttpError(404, 'Class not found.');
    res.json({ ok: true });
  })
);

const subjectSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(150),
  classId: uuid,
  semester: z.string().trim().min(1).max(30),
  credits: z.number().int().min(0).max(20),
});

adminRouter.post(
  '/subjects',
  asyncHandler(async (req, res) => {
    const body = subjectSchema.parse(req.body);
    const cls = await requireClass(body.classId);
    if (!cls.semesters.includes(body.semester)) {
      throw new HttpError(422, `${body.semester} is not one of the semesters of ${cls.name}.`);
    }
    const code = body.code.toUpperCase();
    const { rows } = await withDuplicateMessage(`Subject code ${code} already exists for this class.`, () =>
      db.query(
        `insert into subjects (code, name, class_id, semester, credits)
         values ($1, $2, $3, $4, $5) returning *`,
        [code, body.name, body.classId, body.semester, body.credits]
      )
    );
    res.status(201).json(subjectJson(rows[0]));
  })
);

adminRouter.delete(
  '/subjects/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const result = await withInUseMessage(
      'Feedback has already been collected for this subject, so it cannot be deleted.',
      () => db.query(`delete from subjects where id = $1`, [id])
    );
    if (result.rowCount === 0) throw new HttpError(404, 'Subject not found.');
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- teachers

adminRouter.get(
  '/teachers',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(`select * from teachers order by name`);
    res.json(rows.map(teacherJson));
  })
);

const teacherSchema = z.object({
  employeeCode: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(100),
  designation: z.string().trim().min(2).max(100),
  email: z.string().trim().email('Enter a valid email address.').max(150),
  active: z.boolean().default(true),
});

adminRouter.post(
  '/teachers',
  asyncHandler(async (req, res) => {
    const b = teacherSchema.parse(req.body);
    const { rows } = await withDuplicateMessage('A teacher with that employee code already exists.', () =>
      db.query(
        `insert into teachers (employee_code, name, department, designation, email, active)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [b.employeeCode, b.name, b.department, b.designation, b.email, b.active]
      )
    );
    res.status(201).json(teacherJson(rows[0]));
  })
);

adminRouter.put(
  '/teachers/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const b = teacherSchema.parse(req.body);
    const { rows } = await withDuplicateMessage('A teacher with that employee code already exists.', () =>
      db.query(
        `update teachers
            set employee_code = $2, name = $3, department = $4, designation = $5, email = $6, active = $7
          where id = $1 returning *`,
        [id, b.employeeCode, b.name, b.department, b.designation, b.email, b.active]
      )
    );
    if (rows.length === 0) throw new HttpError(404, 'Teacher not found.');
    res.json(teacherJson(rows[0]));
  })
);

// ------------------------------------------------------------- assignments

const assignmentJson = (r: any) => ({
  id: r.id,
  classId: r.class_id,
  semester: r.semester,
  subjectId: r.subject_id,
  teacherId: r.teacher_id,
  academicYear: r.academic_year,
});

const ASSIGNMENT_SELECT = `
  select a.id, s.class_id, s.semester, a.subject_id, a.teacher_id, a.academic_year
    from assignments a
    join subjects s on s.id = a.subject_id`;

adminRouter.get(
  '/assignments',
  asyncHandler(async (_req, res) => {
    const [assignments, classes, subjects, teachers] = await Promise.all([
      db.query(`${ASSIGNMENT_SELECT} order by s.code`),
      db.query(`select * from classes order by level, name`),
      db.query(`select * from subjects order by code`),
      db.query(`select * from teachers order by name`),
    ]);
    res.json({
      assignments: assignments.rows.map(assignmentJson),
      classes: classes.rows.map(classJson),
      subjects: subjects.rows.map(subjectJson),
      teachers: teachers.rows.map(teacherJson),
    });
  })
);

const assignmentSchema = z.object({
  classId: uuid,
  semester: z.string().trim().min(1).max(30),
  subjectId: uuid,
  teacherId: uuid,
  academicYear: yearString,
  /** false (default): this teacher replaces the subject's current teacher. true: adds a second teacher. */
  addAnother: z.boolean().default(false),
});

adminRouter.post(
  '/assignments',
  asyncHandler(async (req, res) => {
    const b = assignmentSchema.parse(req.body);

    const subject = await db.query(`select class_id, semester from subjects where id = $1`, [b.subjectId]);
    if (subject.rows.length === 0) throw new HttpError(404, 'Subject not found.');
    if (subject.rows[0].class_id !== b.classId || subject.rows[0].semester !== b.semester) {
      throw new HttpError(422, 'That subject does not belong to the selected class and semester.');
    }
    const teacher = await db.query(`select active from teachers where id = $1`, [b.teacherId]);
    if (teacher.rows.length === 0) throw new HttpError(404, 'Teacher not found.');
    if (!teacher.rows[0].active) throw new HttpError(422, 'That teacher is marked inactive.');

    const id = await db.tx(async (client) => {
      const existing = await client.query(
        `select id, teacher_id from assignments where subject_id = $1 and academic_year = $2`,
        [b.subjectId, b.academicYear]
      );
      const same = existing.rows.find((r) => r.teacher_id === b.teacherId);
      if (same) return same.id as string; // already assigned, nothing to do

      if (!b.addAnother && existing.rows.length > 0) {
        try {
          await client.query(
            `delete from assignments where subject_id = $1 and academic_year = $2 and teacher_id <> $3`,
            [b.subjectId, b.academicYear, b.teacherId]
          );
        } catch (err: any) {
          if (err?.code === '23503') {
            throw new HttpError(
              409,
              'Feedback has already been collected for the current teacher of this subject, so they cannot be replaced. Add the new teacher as an additional teacher instead.',
              'IN_USE'
            );
          }
          throw err;
        }
      }
      const inserted = await client.query(
        `insert into assignments (subject_id, teacher_id, academic_year) values ($1, $2, $3) returning id`,
        [b.subjectId, b.teacherId, b.academicYear]
      );
      return inserted.rows[0].id as string;
    });

    const { rows } = await db.query(`${ASSIGNMENT_SELECT} where a.id = $1`, [id]);
    res.status(201).json(assignmentJson(rows[0]));
  })
);

adminRouter.delete(
  '/assignments/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const result = await withInUseMessage(
      'Feedback has already been collected for this teacher, so the assignment cannot be removed.',
      () => db.query(`delete from assignments where id = $1`, [id])
    );
    if (result.rowCount === 0) throw new HttpError(404, 'Assignment not found.');
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- students

adminRouter.get(
  '/students',
  asyncHandler(async (_req, res) => {
    const [students, classes] = await Promise.all([
      loadStudents(''),
      db.query(`select * from classes order by level, name`),
    ]);
    res.json({ students, classes: classes.rows.map(classJson) });
  })
);

const importRowSchema = z.object({
  rollNumber: z
    .string()
    .trim()
    .min(3, 'Roll number is too short.')
    .max(20, 'Roll number is too long.')
    .regex(/^[A-Za-z0-9_\-/]+$/, 'Roll number may only contain letters, digits, - _ /'),
  name: z.string().trim().min(2, 'Name is too short.').max(100),
  className: z.string().trim().min(1, 'Class is missing.').max(100),
  semester: z.string().trim().min(1, 'Semester is missing.').max(30),
  attendancePercent: z.number('Attendance must be a number.').min(0).max(100, 'Attendance cannot exceed 100.'),
  attendedClasses: z.number().int().min(0).optional(),
  totalClasses: z.number().int().min(0).optional(),
});

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1, 'The file has no rows.').max(5000, 'Import at most 5000 rows at a time.'),
});

adminRouter.post(
  '/students/import',
  asyncHandler(async (req, res) => {
    const { rows: rawRows } = importSchema.parse(req.body);

    const classRows = (await db.query(`select id, name, semesters from classes`)).rows;
    const classByName = new Map(classRows.map((c) => [String(c.name).toLowerCase(), c]));

    const skipped: Array<{ rowNumber: number; errors: string[] }> = [];
    const valid = new Map<string, any>(); // roll number -> row (last one wins)

    rawRows.forEach((raw, index) => {
      const rowNumber = typeof raw.rowNumber === 'number' ? raw.rowNumber : index + 1;
      const parsed = importRowSchema.safeParse(raw);
      const errors: string[] = parsed.success ? [] : parsed.error.issues.map((i) => i.message);

      if (parsed.success) {
        const r = parsed.data;
        const cls = classByName.get(r.className.toLowerCase());
        if (!cls) errors.push(`Class "${r.className}" does not exist.`);
        else if (!cls.semesters.includes(r.semester)) {
          errors.push(`${r.semester} is not a semester of ${cls.name}.`);
        }
        const total = r.totalClasses ?? 150;
        const attended = r.attendedClasses ?? Math.round((r.attendancePercent / 100) * total);
        if (attended > total) errors.push('Attended classes cannot exceed total classes.');

        if (errors.length === 0) {
          valid.set(r.rollNumber.toUpperCase(), {
            rollNumber: r.rollNumber.toUpperCase(),
            name: r.name,
            classId: cls!.id,
            semester: r.semester,
            percent: r.attendancePercent,
            attended,
            total,
          });
        }
      }
      if (errors.length > 0) skipped.push({ rowNumber, errors });
    });

    let importedCount = 0;
    let updatedCount = 0;

    if (valid.size > 0) {
      const list = [...valid.values()];
      const passwordHash = await hashPassword(config.initialStudentPassword);
      const result = await db.query(
        `insert into students
           (roll_number, name, class_id, semester, attendance_percent, attended_classes, total_classes,
            password_hash, must_change_password)
         select t.roll, t.name, t.class_id, t.semester, t.pct, t.attended, t.total, $8, true
           from unnest($1::text[], $2::text[], $3::uuid[], $4::text[], $5::numeric[], $6::int[], $7::int[])
                as t(roll, name, class_id, semester, pct, attended, total)
         on conflict (roll_number) do update
            set name = excluded.name,
                class_id = excluded.class_id,
                semester = excluded.semester,
                attendance_percent = excluded.attendance_percent,
                attended_classes = excluded.attended_classes,
                total_classes = excluded.total_classes,
                updated_at = now()
         returning (xmax = 0) as inserted`,
        [
          list.map((r) => r.rollNumber),
          list.map((r) => r.name),
          list.map((r) => r.classId),
          list.map((r) => r.semester),
          list.map((r) => r.percent),
          list.map((r) => r.attended),
          list.map((r) => r.total),
          passwordHash,
        ]
      );
      importedCount = result.rows.filter((r) => r.inserted).length;
      updatedCount = result.rows.length - importedCount;
    }

    res.json({ importedCount, updatedCount, skipped });
  })
);

// ------------------------------------------------------------------- forms

adminRouter.get(
  '/forms',
  asyncHandler(async (_req, res) => {
    const [forms, classes] = await Promise.all([
      loadForms(''),
      db.query(`select * from classes order by level, name`),
    ]);
    res.json({ forms, classes: classes.rows.map(classJson) });
  })
);

const questionSchema = z.object({
  category: z.string().trim().min(1).max(80),
  text: z.string().trim().min(5, 'Each question needs at least a few words.').max(255),
});

const formSchema = z.object({
  id: uuid.optional(),
  title: z.string().trim().max(150).default(''),
  classId: uuid,
  semester: z.string().trim().min(1).max(30),
  academicYear: yearString,
  minAttendance: z.number().min(0).max(100),
  openDate: dateString,
  closeDate: dateString,
  status: z.enum(['draft', 'open', 'closed']),
  questions: z
    .array(questionSchema)
    .min(1, 'Please add or generate at least one evaluation question.')
    .max(30, 'A form can have at most 30 questions.'),
});

/** A form can only be opened if it has questions and at least one teacher to rate. */
async function assertCanOpen(client: Queryable, classId: string, semester: string, academicYear: string) {
  const teachers = await expectedAssignments(classId, semester, academicYear, client);
  if (teachers.length === 0) {
    throw new HttpError(
      422,
      'Assign at least one teacher to this class and semester before opening the form.',
      'NO_TEACHERS'
    );
  }
}

async function hasFeedback(client: Queryable, formId: string): Promise<boolean> {
  const { rows } = await client.query(
    `select exists(select 1 from submissions where form_id = $1)
         or exists(select 1 from responses   where form_id = $1) as used`,
    [formId]
  );
  return rows[0].used;
}

adminRouter.post(
  '/forms',
  asyncHandler(async (req, res) => {
    const b = formSchema.parse(req.body);
    if (b.closeDate < b.openDate) throw new HttpError(422, 'The closing date cannot be before the opening date.');

    const formId = await db.tx(async (client) => {
      const cls = await requireClass(b.classId, client);
      if (!cls.semesters.includes(b.semester)) {
        throw new HttpError(422, `${b.semester} is not one of the semesters of ${cls.name}.`);
      }
      const title = b.title || `Faculty Evaluation · ${cls.name} (${b.semester})`;

      if (!b.id) {
        if (b.status === 'open') await assertCanOpen(client, b.classId, b.semester, b.academicYear);
        const created = await withDuplicateMessage(
          'A form already exists for this class, semester and academic year. Edit that form instead.',
          () =>
            client.query(
              `insert into forms (title, class_id, semester, academic_year, min_attendance, open_date, close_date, status)
               values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
              [title, b.classId, b.semester, b.academicYear, b.minAttendance, b.openDate, b.closeDate, b.status]
            )
        );
        const id = created.rows[0].id as string;
        await insertQuestions(client, id, b.questions);
        return id;
      }

      // ---- update an existing form
      const existing = await client.query(`select * from forms where id = $1 for update`, [b.id]);
      if (existing.rows.length === 0) throw new HttpError(404, 'Form not found.');
      const old = existing.rows[0];
      const used = await hasFeedback(client, b.id);

      const identityChanged =
        old.class_id !== b.classId || old.semester !== b.semester || old.academic_year !== b.academicYear;
      if (used && identityChanged) {
        throw new HttpError(409, 'Feedback has already been submitted, so the class, semester and year cannot change.');
      }
      if (used && b.status === 'draft') {
        throw new HttpError(409, 'Feedback has already been submitted, so this form cannot go back to draft.');
      }
      if (b.status === 'open') await assertCanOpen(client, b.classId, b.semester, b.academicYear);

      const locked = old.status !== 'draft' || used;
      if (locked) {
        const stored = await client.query(
          `select category, text from form_questions where form_id = $1 order by sort_order`,
          [b.id]
        );
        const same =
          stored.rows.length === b.questions.length &&
          stored.rows.every((s, i) => s.category === b.questions[i].category && s.text === b.questions[i].text);
        if (!same) {
          throw new HttpError(
            409,
            'Questions are locked once a form has been opened, so every student answers the same questions.',
            'QUESTIONS_LOCKED'
          );
        }
      }

      await withDuplicateMessage(
        'A form already exists for this class, semester and academic year.',
        () =>
          client.query(
            `update forms
                set title = $2, class_id = $3, semester = $4, academic_year = $5, min_attendance = $6,
                    open_date = $7, close_date = $8, status = $9, updated_at = now()
              where id = $1`,
            [b.id, title, b.classId, b.semester, b.academicYear, b.minAttendance, b.openDate, b.closeDate, b.status]
          )
      );
      if (!locked) {
        await client.query(`delete from form_questions where form_id = $1`, [b.id]);
        await insertQuestions(client, b.id, b.questions);
      }
      return b.id;
    });

    const [form] = await loadForms('f.id = $1', [formId]);
    res.status(b.id ? 200 : 201).json(form);
  })
);

async function insertQuestions(
  client: Queryable,
  formId: string,
  questions: Array<{ category: string; text: string }>
) {
  await client.query(
    `insert into form_questions (form_id, category, text, sort_order)
     select $1, t.category, t.text, t.ord
       from unnest($2::text[], $3::text[], $4::int[]) as t(category, text, ord)`,
    [formId, questions.map((q) => q.category), questions.map((q) => q.text), questions.map((_, i) => i + 1)]
  );
}

const statusSchema = z.object({ status: z.enum(['draft', 'open', 'closed']) });

adminRouter.patch(
  '/forms/:id/status',
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const { status } = statusSchema.parse(req.body);

    await db.tx(async (client) => {
      const existing = await client.query(`select * from forms where id = $1 for update`, [id]);
      if (existing.rows.length === 0) throw new HttpError(404, 'Form not found.');
      const f = existing.rows[0];

      if (status === 'draft' && (await hasFeedback(client, id))) {
        throw new HttpError(409, 'Feedback has already been submitted, so this form cannot go back to draft.');
      }
      if (status === 'open') {
        const q = await client.query(`select count(*)::int as n from form_questions where form_id = $1`, [id]);
        if (q.rows[0].n === 0) throw new HttpError(422, 'Add at least one question before opening the form.');
        await assertCanOpen(client, f.class_id, f.semester, f.academic_year);
      }
      await client.query(`update forms set status = $2, updated_at = now() where id = $1`, [id, status]);
    });

    const [form] = await loadForms('f.id = $1', [id]);
    res.json(form);
  })
);
