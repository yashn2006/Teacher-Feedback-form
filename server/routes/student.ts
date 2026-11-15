import { randomInt } from 'node:crypto';
import { Router } from 'express';
import type { EvaluationForm, FeedbackState, StudentDashboardPayload } from '../../src/types';
import { z } from 'zod';
import { requireActiveStudent } from '../auth';
import { db, todayInIndia } from '../db';
import { asyncHandler, HttpError, idParam } from '../errors';
import { expectedAssignments, loadForms, loadStudents, toIso } from '../queries';

export const studentRouter = Router();

// ------------------------------------------------------------ dashboard

studentRouter.get(
  '/dashboard',
  requireActiveStudent,
  asyncHandler(async (req, res) => {
    const session = req.student!;
    const [student] = await loadStudents('s.id = $1', [session.id]);
    const today = await todayInIndia();

    // The newest published form for this student's class and semester.
    const forms = await loadForms(`f.class_id = $1 and f.semester = $2 and f.status <> 'draft'`, [
      student.classId,
      student.semester,
    ]);
    let form: EvaluationForm | null = forms[0] ?? null;

    let feedbackState: FeedbackState = 'none';
    let submissionRecord: StudentDashboardPayload['submissionRecord'];

    if (form) {
      const record = student.submissionRecords?.[form.id];
      if (record) {
        feedbackState = 'submitted';
        submissionRecord = record;
      } else if (form.status === 'closed' || today > form.closeDate) {
        feedbackState = 'closed';
      } else if (today < form.openDate) {
        // Published but the opening date has not arrived yet: show nothing.
        feedbackState = 'none';
        form = null;
      } else if (student.attendancePercent < form.minAttendance) {
        feedbackState = 'not_eligible';
      } else {
        feedbackState = 'open';
      }
    }

    const subjects = form
      ? await expectedAssignments(student.classId, student.semester, form.academicYear)
      : [];

    const payload: StudentDashboardPayload = { student, form, feedbackState, subjects, submissionRecord };
    res.json(payload);
  })
);

// --------------------------------------------------------------- submit

const submitSchema = z.object({
  entries: z
    .array(
      z.object({
        subjectId: z.string().min(1),
        teacherId: z.string().min(1),
        ratings: z.record(z.string(), z.number()),
        comment: z.string().max(500, 'Comments can be at most 500 characters.').optional(),
      })
    )
    .min(1)
    .max(40),
});

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

function newReferenceId(): string {
  const year = new Date().getFullYear().toString().slice(-2);
  let code = '';
  for (let i = 0; i < 10; i++) code += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `SIES-EV-${year}-${code}`;
}

studentRouter.post(
  '/feedback/:formId/submit',
  requireActiveStudent,
  asyncHandler(async (req, res) => {
    const formId = idParam(req.params.formId);
    const { entries } = submitSchema.parse(req.body);
    const student = req.student!;
    const today = await todayInIndia();

    const result = await db.tx(async (client) => {
      // Lock the form row so it cannot be closed halfway through this submission.
      const lock = await client.query(`select id from forms where id = $1 for share`, [formId]);
      if (lock.rows.length === 0) throw new HttpError(404, 'Evaluation form not found.');

      const [form] = await loadForms('f.id = $1', [formId], client);

      if (form.classId !== student.class_id || form.semester !== student.semester) {
        throw new HttpError(403, 'This evaluation form is not for your class.', 'WRONG_CLASS');
      }
      if (form.status !== 'open' || today > form.closeDate || today < form.openDate) {
        throw new HttpError(409, 'This evaluation form is no longer open for submissions.', 'FORM_CLOSED');
      }
      if (student.attendance_percent < form.minAttendance) {
        throw new HttpError(
          403,
          `Attendance below required ${form.minAttendance}% minimum.`,
          'NOT_ELIGIBLE'
        );
      }

      // The answers must cover exactly the teachers on this student's form.
      const expected = await expectedAssignments(form.classId, form.semester, form.academicYear, client);
      const byKey = new Map(expected.map((e) => [`${e.subjectId}:${e.teacherId}`, e]));
      if (entries.length !== expected.length) {
        throw new HttpError(422, 'Please complete the feedback for every teacher on the form.');
      }
      const seen = new Set<string>();
      for (const entry of entries) {
        const key = `${entry.subjectId}:${entry.teacherId}`;
        if (!byKey.has(key) || seen.has(key)) {
          throw new HttpError(422, 'The teachers on this form have changed. Please reload the page and try again.');
        }
        seen.add(key);
        for (const q of form.questions) {
          const score = entry.ratings[q.id];
          if (!Number.isInteger(score) || score < 1 || score > 5) {
            throw new HttpError(422, 'Please answer every question for all subjects before submitting.');
          }
        }
      }

      // One submission per student per form. The unique key decides if two arrive together.
      const referenceId = newReferenceId();
      const inserted = await client.query(
        `insert into submissions (form_id, student_id, reference_id)
         values ($1, $2, $3)
         on conflict (form_id, student_id) do nothing
         returning submitted_at`,
        [formId, student.id, referenceId]
      );
      if (inserted.rows.length === 0) {
        throw new HttpError(409, 'You have already submitted this evaluation form.', 'ALREADY_SUBMITTED');
      }

      // The answers are stored with no link to the student.
      for (const entry of entries) {
        const assignment = byKey.get(`${entry.subjectId}:${entry.teacherId}`)!;
        const comment = entry.comment?.trim() ? entry.comment.trim() : null;
        const resp = await client.query(
          `insert into responses (form_id, assignment_id, comment) values ($1, $2, $3) returning id`,
          [formId, assignment.assignmentId, comment]
        );
        await client.query(
          `insert into response_ratings (response_id, question_id, score)
           select $1, t.q, t.s from unnest($2::uuid[], $3::int[]) as t(q, s)`,
          [
            resp.rows[0].id,
            form.questions.map((q) => q.id),
            form.questions.map((q) => entry.ratings[q.id]),
          ]
        );
      }

      return { referenceId, submittedAt: toIso(inserted.rows[0].submitted_at) };
    });

    res.status(201).json(result);
  })
);
