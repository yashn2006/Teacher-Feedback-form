import type {
  EvaluationForm,
  FormStatus,
  ClassLevel,
  StudentRecord,
  SubjectTeacherPair,
} from '../src/types';
import { db } from './db';

/** Anything with a query method: the pool wrapper or a transaction client. */
export interface Queryable {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const toIso = (v: unknown) => new Date(v as string).toISOString();

// ---------------------------------------------------------------- forms

const FORM_SELECT = `
  select f.id,
         f.title,
         f.class_id,
         c.name   as class_name,
         c.course as course,
         c.level  as level,
         f.semester,
         f.academic_year,
         f.min_attendance,
         f.open_date::text  as open_date,
         f.close_date::text as close_date,
         f.status,
         (select count(*) from students s
           where s.class_id = f.class_id
             and s.semester = f.semester
             and s.attendance_percent >= f.min_attendance)::int as eligible_count,
         (select count(*) from submissions sub where sub.form_id = f.id)::int as submitted_count
    from forms f
    join classes c on c.id = f.class_id`;

/** Loads forms with their questions. `where` is raw SQL using $1.. placeholders for `params`. */
export async function loadForms(
  where: string,
  params: unknown[] = [],
  q: Queryable = db
): Promise<EvaluationForm[]> {
  const { rows } = await q.query(
    `${FORM_SELECT} ${where ? `where ${where}` : ''} order by f.academic_year desc, f.created_at desc`,
    params as any[]
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const qs = await q.query(
    `select id, form_id, category, text, sort_order
       from form_questions
      where form_id = any($1::uuid[])
      order by form_id, sort_order`,
    [ids]
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    classId: r.class_id,
    className: r.class_name,
    course: r.course,
    level: r.level as ClassLevel,
    semester: r.semester,
    academicYear: r.academic_year,
    minAttendance: r.min_attendance,
    openDate: r.open_date,
    closeDate: r.close_date,
    status: r.status as FormStatus,
    questions: qs.rows
      .filter((x) => x.form_id === r.id)
      .map((x) => ({ id: x.id, category: x.category, text: x.text, order: x.sort_order })),
    eligibleCount: r.eligible_count,
    submittedCount: r.submitted_count,
  }));
}

// ------------------------------------------------------------- students

/** Students as the frontend sees them. The password hash is never selected. */
export async function loadStudents(
  where: string,
  params: unknown[] = [],
  q: Queryable = db
): Promise<Array<Omit<StudentRecord, 'password'>>> {
  const { rows } = await q.query(
    `select s.id,
            s.roll_number,
            s.name,
            s.class_id,
            c.name   as class_name,
            c.course as course,
            c.level  as level,
            s.semester,
            s.attendance_percent,
            s.attended_classes,
            s.total_classes,
            s.must_change_password,
            coalesce(
              json_agg(json_build_object(
                'formId', sub.form_id,
                'referenceId', sub.reference_id,
                'submittedAt', sub.submitted_at
              )) filter (where sub.id is not null),
              '[]'::json
            ) as subs
       from students s
       join classes c on c.id = s.class_id
       left join submissions sub on sub.student_id = s.id
      ${where ? `where ${where}` : ''}
      group by s.id, c.id
      order by s.roll_number`,
    params as any[]
  );

  return rows.map((r) => {
    const subs = r.subs as Array<{ formId: string; referenceId: string; submittedAt: string }>;
    const submissionRecords: Record<string, { submittedAt: string; referenceId: string }> = {};
    for (const s of subs) {
      submissionRecords[s.formId] = { submittedAt: toIso(s.submittedAt), referenceId: s.referenceId };
    }
    return {
      id: r.id,
      rollNumber: r.roll_number,
      name: r.name,
      classId: r.class_id,
      className: r.class_name,
      course: r.course,
      level: r.level as ClassLevel,
      semester: r.semester,
      attendancePercent: r.attendance_percent,
      attendedClasses: r.attended_classes,
      totalClasses: r.total_classes,
      mustChangePassword: r.must_change_password,
      submittedFormIds: subs.map((s) => s.formId),
      submissionRecords,
    };
  });
}

// ---------------------------------------------------------- assignments

/** Every teacher a student of this class must rate on the form. One entry per teacher. */
export async function expectedAssignments(
  classId: string,
  semester: string,
  academicYear: string,
  q: Queryable = db
): Promise<Array<SubjectTeacherPair & { assignmentId: string }>> {
  const { rows } = await q.query(
    `select a.id   as assignment_id,
            s.id   as subject_id,
            s.code as subject_code,
            s.name as subject_name,
            t.id   as teacher_id,
            t.name as teacher_name,
            t.designation,
            t.department
       from assignments a
       join subjects s on s.id = a.subject_id
       join teachers t on t.id = a.teacher_id
      where s.class_id = $1
        and s.semester = $2
        and a.academic_year = $3
        and t.active
      order by s.code, t.name`,
    [classId, semester, academicYear]
  );
  return rows.map((r) => ({
    assignmentId: r.assignment_id,
    subjectId: r.subject_id,
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    teacherDesignation: r.designation,
    teacherDepartment: r.department,
  }));
}
