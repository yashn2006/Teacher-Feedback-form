import { Router } from 'express';
import { z } from 'zod';
import { RATING_SCALE } from '../../src/types';
import type { AnalysisReportPayload, ClassLevel, TeacherAnalysisItem } from '../../src/types';
import { requireStaff } from '../auth';
import { db } from '../db';
import { asyncHandler } from '../errors';
import { round1, round2 } from '../queries';

export const analysisRouter = Router();
analysisRouter.use(requireStaff);

/** A teacher/subject/class with fewer responses than this is hidden, so no single student can be identified. */
export const MIN_RESPONSES_TO_SHOW = 5;

const filterSchema = z.object({
  academicYear: z.string().max(20).default('ALL'),
  level: z.string().max(10).default('ALL'),
  semester: z.string().max(30).default('ALL'),
  course: z.string().max(100).default('ALL'),
});

// $1 academic year, $2 level, $3 semester, $4 course. 'ALL' means no filter.
const FILTER_SQL = `
  ($1 = 'ALL' or f.academic_year = $1)
  and ($2 = 'ALL' or c.level = $2)
  and ($3 = 'ALL' or f.semester = $3)
  and ($4 = 'ALL' or c.course = $4)`;

interface Group {
  assignmentId: string;
  teacherId: string;
  teacherName: string;
  department: string;
  subjectCode: string;
  subjectName: string;
  classId: string;
  className: string;
  level: ClassLevel;
  course: string;
  semester: string;
  responseCount: number;
  dist: [number, number, number, number, number];
  cats: Record<string, { sum: number; count: number }>;
  comments: Array<{ submittedAt: string; text: string }>;
}

const sumDist = (d: number[]) => d.reduce((n, c, i) => n + c * (i + 1), 0);
const countDist = (d: number[]) => d.reduce((n, c) => n + c, 0);

analysisRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const filters = filterSchema.parse(req.body);
    const admin = req.admin!;

    // An HOD can only ever see their own course. This is decided here, never by the browser.
    const course = admin.role === 'hod' && admin.course ? admin.course : filters.course;
    const params = [filters.academicYear, filters.level, filters.semester, course];

    const [formRows, groupRows, ratingRows, commentRows] = await Promise.all([
      db.query(
        `select c.id as class_id, c.name as class_name, c.level, c.course, f.semester,
                (select count(*) from students s
                  where s.class_id = f.class_id and s.semester = f.semester
                    and s.attendance_percent >= f.min_attendance)::int as eligible,
                (select count(*) from submissions sub where sub.form_id = f.id)::int as submitted
           from forms f join classes c on c.id = f.class_id
          where f.status <> 'draft' and ${FILTER_SQL}
          order by c.level, c.name`,
        params
      ),
      db.query(
        `select a.id as assignment_id, t.id as teacher_id, t.name as teacher_name, t.department,
                s.code as subject_code, s.name as subject_name,
                c.id as class_id, c.name as class_name, c.level, c.course, f.semester,
                count(r.id)::int as response_count
           from responses r
           join forms f on f.id = r.form_id
           join classes c on c.id = f.class_id
           join assignments a on a.id = r.assignment_id
           join subjects s on s.id = a.subject_id
           join teachers t on t.id = a.teacher_id
          where ${FILTER_SQL}
          group by a.id, t.id, s.id, c.id, f.id`,
        params
      ),
      db.query(
        `select r.assignment_id, q.category, rr.score, count(*)::int as n
           from response_ratings rr
           join responses r on r.id = rr.response_id
           join form_questions q on q.id = rr.question_id
           join forms f on f.id = r.form_id
           join classes c on c.id = f.class_id
          where ${FILTER_SQL}
          group by r.assignment_id, q.category, rr.score`,
        params
      ),
      db.query(
        `select r.assignment_id, r.submitted_on::text as submitted_on, r.comment
           from responses r
           join forms f on f.id = r.form_id
           join classes c on c.id = f.class_id
          where r.comment is not null and r.comment <> '' and ${FILTER_SQL}
          order by r.submitted_on desc, r.id
          limit 5000`,
        params
      ),
    ]);

    // ---- assemble groups
    const groups = new Map<string, Group>();
    for (const g of groupRows.rows) {
      groups.set(g.assignment_id, {
        assignmentId: g.assignment_id,
        teacherId: g.teacher_id,
        teacherName: g.teacher_name,
        department: g.department,
        subjectCode: g.subject_code,
        subjectName: g.subject_name,
        classId: g.class_id,
        className: g.class_name,
        level: g.level,
        course: g.course,
        semester: g.semester,
        responseCount: g.response_count,
        dist: [0, 0, 0, 0, 0],
        cats: {},
        comments: [],
      });
    }
    for (const r of ratingRows.rows) {
      const g = groups.get(r.assignment_id);
      if (!g) continue;
      g.dist[r.score - 1] += r.n;
      const c = (g.cats[r.category] ??= { sum: 0, count: 0 });
      c.sum += r.score * r.n;
      c.count += r.n;
    }
    for (const c of commentRows.rows) {
      groups.get(c.assignment_id)?.comments.push({ submittedAt: c.submitted_on, text: c.comment });
    }

    // ---- apply the privacy rule
    const visible: Group[] = [];
    const hiddenTeachersNotice: AnalysisReportPayload['hiddenTeachersNotice'] = [];
    for (const g of groups.values()) {
      if (g.responseCount < MIN_RESPONSES_TO_SHOW) {
        hiddenTeachersNotice.push({
          teacherName: g.teacherName,
          subjectName: `${g.subjectCode} · ${g.subjectName}`,
          responseCount: g.responseCount,
        });
      } else {
        visible.push(g);
      }
    }

    const teacherRankings: TeacherAnalysisItem[] = visible
      .map((g) => {
        const total = countDist(g.dist);
        const categoryAverages: Record<string, number> = {};
        for (const [cat, v] of Object.entries(g.cats)) categoryAverages[cat] = round2(v.sum / v.count);
        return {
          teacherId: g.teacherId,
          teacherName: g.teacherName,
          department: g.department,
          subjectCode: g.subjectCode,
          subjectName: g.subjectName,
          className: g.className,
          level: g.level,
          course: g.course,
          semester: g.semester,
          responseCount: g.responseCount,
          averageScore: total > 0 ? round2(sumDist(g.dist) / total) : 0,
          categoryAverages,
          distribution: g.dist,
          comments: g.comments.map((c) => ({ submittedAt: c.submittedAt, text: c.text })),
        };
      })
      .sort((a, b) => b.averageScore - a.averageScore);

    // ---- totals from visible groups only
    const overallDist = [0, 0, 0, 0, 0];
    const overallCats: Record<string, { sum: number; count: number }> = {};
    for (const g of visible) {
      g.dist.forEach((n, i) => (overallDist[i] += n));
      for (const [cat, v] of Object.entries(g.cats)) {
        const c = (overallCats[cat] ??= { sum: 0, count: 0 });
        c.sum += v.sum;
        c.count += v.count;
      }
    }
    const grandCount = countDist(overallDist);

    const totalEligible = formRows.rows.reduce((n, f) => n + f.eligible, 0);
    const totalResponses = formRows.rows.reduce((n, f) => n + f.submitted, 0);

    // ---- per-teacher roll-up: average in each class, then one overall average
    const byTeacher = new Map<string, { g: Group[] }>();
    for (const g of visible) {
      const entry = byTeacher.get(g.teacherId) ?? { g: [] };
      entry.g.push(g);
      byTeacher.set(g.teacherId, entry);
    }
    const teacherSummaries = [...byTeacher.values()]
      .map(({ g: list }) => {
        const dist = [0, 0, 0, 0, 0];
        const perClass = new Map<string, { dist: number[]; g: Group; responses: number }>();
        for (const g of list) {
          g.dist.forEach((n, i) => (dist[i] += n));
          const c = perClass.get(g.classId) ?? { dist: [0, 0, 0, 0, 0], g, responses: 0 };
          g.dist.forEach((n, i) => (c.dist[i] += n));
          c.responses += g.responseCount;
          perClass.set(g.classId, c);
        }
        const total = countDist(dist);
        return {
          teacherId: list[0].teacherId,
          teacherName: list[0].teacherName,
          department: list[0].department,
          overallAverage: total > 0 ? round2(sumDist(dist) / total) : 0,
          responseCount: list.reduce((n, g) => n + g.responseCount, 0),
          classes: [...perClass.values()].map((c) => ({
            classId: c.g.classId,
            className: c.g.className,
            level: c.g.level,
            course: c.g.course,
            averageScore: countDist(c.dist) > 0 ? round2(sumDist(c.dist) / countDist(c.dist)) : 0,
            responseCount: c.responses,
          })),
        };
      })
      .sort((a, b) => b.overallAverage - a.overallAverage);

    const payload: AnalysisReportPayload & { teacherSummaries: typeof teacherSummaries } = {
      summary: {
        totalResponses,
        totalEligible,
        responseRate: totalEligible > 0 ? round1((totalResponses / totalEligible) * 100) : 0,
        overallAverage: grandCount > 0 ? round2(sumDist(overallDist) / grandCount) : 0,
        visibleTeachersCount: visible.length,
        hiddenTeachersCount: hiddenTeachersNotice.length,
      },
      teacherRankings,
      hiddenTeachersNotice,
      categoryAverages: Object.entries(overallCats).map(([category, v]) => ({
        category,
        average: round2(v.sum / v.count),
      })),
      ratingDistribution: RATING_SCALE.map((scale, i) => ({
        rating: scale.value,
        label: scale.label,
        count: overallDist[i],
        percent: grandCount > 0 ? round1((overallDist[i] / grandCount) * 100) : 0,
      })),
      classResponseRates: formRows.rows.map((f) => ({
        classId: f.class_id,
        className: f.class_name,
        level: f.level,
        course: f.course,
        semester: f.semester,
        eligible: f.eligible,
        submitted: f.submitted,
        rate: f.eligible > 0 ? round1((f.submitted / f.eligible) * 100) : 0,
      })),
      teacherSummaries,
    };

    res.json(payload);
  })
);

/** Values for the filter drop-downs. An HOD only gets their own course. */
analysisRouter.get(
  '/filters',
  asyncHandler(async (req, res) => {
    const admin = req.admin!;
    const course = admin.role === 'hod' ? admin.course : null;

    const years = await db.query(
      `select distinct f.academic_year
         from forms f join classes c on c.id = f.class_id
        where ($1::text is null or c.course = $1)
        order by f.academic_year desc`,
      [course]
    );
    const courses = await db.query(
      `select distinct course from classes where ($1::text is null or course = $1) order by course`,
      [course]
    );
    res.json({
      academicYears: years.rows.map((r) => r.academic_year),
      courses: courses.rows.map((r) => r.course),
      semesters: ['Semester I', 'Semester II', 'Semester III', 'Semester IV', 'Semester V', 'Semester VI'],
      levels: ['FY', 'SY', 'TY', 'PG-I', 'PG-II'],
    });
  })
);
