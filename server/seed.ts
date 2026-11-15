import { randomInt, randomUUID } from 'node:crypto';
import { INITIAL_MOCK_DB } from '../src/data/mockDb';
import { hashPassword } from './auth';
import { db, todayInIndia } from './db';

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const refId = () =>
  `SIES-EV-26-${Array.from({ length: 10 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')}`;

export interface SeedResult {
  classes: number;
  teachers: number;
  subjects: number;
  assignments: number;
  students: number;
  admins: number;
  forms: number;
  responses: number;
  skippedResponses: number;
  submissions: number;
}

/**
 * Loads the demo data that used to live in the browser (src/data/mockDb.ts) into the database.
 * Form dates are moved so the "open" forms are open today. For demos and development only:
 * it contains well-known passwords.
 */
export async function seedDemoData(options: { reset: boolean }): Promise<SeedResult> {
  const mock = INITIAL_MOCK_DB;
  const today = await todayInIndia();
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const hashes = new Map<string, string>();
  const hashOnce = async (pw: string) => {
    if (!hashes.has(pw)) hashes.set(pw, await hashPassword(pw));
    return hashes.get(pw)!;
  };

  return db.tx(async (c) => {
    if (options.reset) {
      await c.query(
        `truncate table response_ratings, responses, submissions, form_questions, forms,
                        assignments, students, subjects, teachers, classes, admins cascade`
      );
    } else {
      const existing = await c.query(`select (select count(*) from classes) as n`);
      if (Number(existing.rows[0].n) > 0) {
        throw new Error('The database already has data. Run again with --reset to wipe it and reseed.');
      }
    }

    // ---- classes, teachers, subjects (mock ids are replaced by real uuids)
    const classId = new Map<string, string>();
    for (const x of mock.classes) {
      const r = await c.query(
        `insert into classes (name, level, course, division, semesters) values ($1,$2,$3,$4,$5) returning id`,
        [x.name, x.level, x.course, x.division, x.semesters]
      );
      classId.set(x.id, r.rows[0].id);
    }

    const teacherId = new Map<string, string>();
    for (const x of mock.teachers) {
      const r = await c.query(
        `insert into teachers (employee_code, name, department, designation, email, active)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [x.employeeCode, x.name, x.department, x.designation, x.email, x.active]
      );
      teacherId.set(x.id, r.rows[0].id);
    }

    const subjectId = new Map<string, string>();
    for (const x of mock.subjects) {
      const r = await c.query(
        `insert into subjects (code, name, class_id, semester, credits) values ($1,$2,$3,$4,$5) returning id`,
        [x.code, x.name, classId.get(x.classId), x.semester, x.credits]
      );
      subjectId.set(x.id, r.rows[0].id);
    }

    // ---- assignments, keyed by mock subject + teacher so responses can find them
    const assignmentId = new Map<string, string>();
    for (const x of mock.assignments) {
      const r = await c.query(
        `insert into assignments (subject_id, teacher_id, academic_year) values ($1,$2,$3) returning id`,
        [subjectId.get(x.subjectId), teacherId.get(x.teacherId), x.academicYear]
      );
      assignmentId.set(`${x.subjectId}:${x.teacherId}`, r.rows[0].id);
    }

    // ---- students
    const studentId = new Map<string, string>();
    for (const x of mock.students) {
      const r = await c.query(
        `insert into students
           (roll_number, name, class_id, semester, attendance_percent, attended_classes, total_classes,
            must_change_password, password_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          x.rollNumber.toUpperCase(),
          x.name,
          classId.get(x.classId),
          x.semester,
          x.attendancePercent,
          x.attendedClasses,
          x.totalClasses,
          x.mustChangePassword,
          await hashOnce(x.password),
        ]
      );
      studentId.set(x.id, r.rows[0].id);
    }

    // ---- staff
    for (const x of mock.admins) {
      await c.query(
        `insert into admins (email, name, role, course, designation, password_hash)
         values ($1,$2,$3,$4,$5,$6)`,
        [x.email, x.name, x.role, x.role === 'hod' ? x.course : null, x.designation, await hashOnce(x.password)]
      );
    }

    // ---- forms and questions
    const formId = new Map<string, string>();
    const questionIds = new Map<string, string[]>(); // mock form id -> question uuids in order
    for (const f of mock.forms) {
      const dates =
        f.status === 'open'
          ? [shift(-9), shift(11)]
          : f.status === 'closed'
            ? [shift(-35), shift(-3)]
            : [shift(3), shift(23)];
      const r = await c.query(
        `insert into forms (title, class_id, semester, academic_year, min_attendance, open_date, close_date, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [f.title, classId.get(f.classId), f.semester, f.academicYear, f.minAttendance, dates[0], dates[1], f.status]
      );
      formId.set(f.id, r.rows[0].id);

      const ids: string[] = [];
      for (const q of f.questions) {
        const qr = await c.query(
          `insert into form_questions (form_id, category, text, sort_order) values ($1,$2,$3,$4) returning id`,
          [r.rows[0].id, q.category, q.text, q.order]
        );
        ids.push(qr.rows[0].id);
      }
      questionIds.set(f.id, ids);
    }

    // ---- sample responses, inserted in two batches
    const respIds: string[] = [];
    const respForms: string[] = [];
    const respAssignments: string[] = [];
    const respComments: Array<string | null> = [];
    const respDates: string[] = [];
    const rateResp: string[] = [];
    const rateQuestion: string[] = [];
    const rateScore: number[] = [];
    let skippedResponses = 0;

    for (const r of mock.responses) {
      const fId = formId.get(r.formId);
      const aId = assignmentId.get(`${r.subjectId}:${r.teacherId}`);
      const qIds = questionIds.get(r.formId);
      if (!fId || !aId || !qIds) {
        skippedResponses++;
        continue;
      }
      const id = randomUUID();
      respIds.push(id);
      respForms.push(fId);
      respAssignments.push(aId);
      respComments.push(r.comment ?? null);
      respDates.push(r.submittedAt.slice(0, 10));
      r.ratings.forEach((rating, i) => {
        if (qIds[i]) {
          rateResp.push(id);
          rateQuestion.push(qIds[i]);
          rateScore.push(rating.score);
        }
      });
    }

    if (respIds.length > 0) {
      await c.query(
        `insert into responses (id, form_id, assignment_id, comment, submitted_on)
         select t.id, t.form_id, t.assignment_id, t.comment, t.submitted_on
           from unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::date[])
                as t(id, form_id, assignment_id, comment, submitted_on)`,
        [respIds, respForms, respAssignments, respComments, respDates]
      );
      await c.query(
        `insert into response_ratings (response_id, question_id, score)
         select t.r, t.q, t.s from unnest($1::uuid[], $2::uuid[], $3::int[]) as t(r, q, s)`,
        [rateResp, rateQuestion, rateScore]
      );
    }

    // ---- who has already submitted (the demo "Already Submitted" student)
    let submissions = 0;
    for (const s of mock.students) {
      for (const mockFormId of s.submittedFormIds ?? []) {
        const rec = s.submissionRecords?.[mockFormId];
        await c.query(
          `insert into submissions (form_id, student_id, reference_id, submitted_at) values ($1,$2,$3,$4)`,
          [formId.get(mockFormId), studentId.get(s.id), rec?.referenceId ?? refId(), rec?.submittedAt ?? new Date()]
        );
        submissions++;
      }
    }

    return {
      classes: mock.classes.length,
      teachers: mock.teachers.length,
      subjects: mock.subjects.length,
      assignments: mock.assignments.length,
      students: mock.students.length,
      admins: mock.admins.length,
      forms: mock.forms.length,
      responses: respIds.length,
      skippedResponses,
      submissions,
    };
  });
}
