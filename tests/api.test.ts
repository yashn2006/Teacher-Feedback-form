/**
 * Integration tests: the real API against a real Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/tfs_test npm test
 *
 * WARNING: this wipes the database it connects to. It refuses anything that is not localhost.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:54329/tfs_test';
const host = new URL(TEST_URL).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Refusing to run tests: this wipes the database, and TEST_DATABASE_URL is not localhost.');
}
process.env.DATABASE_URL = TEST_URL;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.AI_PROVIDER = 'mock';
delete process.env.NODE_ENV;

type Json = any;

class Client {
  cookies = new Map<string, string>();
  constructor(private base: string) {}

  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie();
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: Json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: json, setCookies };
  }
}

describe('SIES teacher evaluation API', () => {
  let base = '';
  let server: import('node:http').Server;
  let db: typeof import('../server/db').db;
  let admin: Client;
  let hodCs: Client;
  let hodIt: Client;
  let forms: Json[] = [];

  const formFor = (className: string, semester: string) =>
    forms.find((f) => f.className === className && f.semester === semester)!;

  async function studentClient(roll: string, password = 'Password@123') {
    const c = new Client(base);
    const r = await c.req('POST', '/api/auth/student/login', { rollNumber: roll, password });
    assert.equal(r.status, 200, `login ${roll}: ${JSON.stringify(r.body)}`);
    if (r.body.mustChangePassword) {
      const ch = await c.req('POST', '/api/auth/student/change-password', {
        currentPassword: password,
        newPassword: 'NewPass@12345',
      });
      assert.equal(ch.status, 200);
    }
    return c;
  }

  const entriesFor = (dash: Json, score = 4) =>
    dash.subjects.map((s: Json) => ({
      subjectId: s.subjectId,
      teacherId: s.teacherId,
      ratings: Object.fromEntries(dash.form.questions.map((q: Json) => [q.id, score])),
      comment: 'Helpful lectures.',
    }));

  before(async () => {
    const { createApp } = await import('../server/app');
    ({ db } = await import('../server/db'));
    const { seedDemoData } = await import('../server/seed');
    const { readFile } = await import('node:fs/promises');

    await db.query('drop schema public cascade; create schema public;');
    await db.query(await readFile('supabase/schema.sql', 'utf8'));
    await seedDemoData({ reset: true });

    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;

    admin = new Client(base);
    assert.equal((await admin.req('POST', '/api/auth/admin/login', { email: 'admin@sies.edu.in', password: 'Admin@2026' })).status, 200);
    hodCs = new Client(base);
    assert.equal((await hodCs.req('POST', '/api/auth/admin/login', { email: 'hod.cs@sies.edu.in', password: 'Hod@2026' })).status, 200);
    hodIt = new Client(base);
    assert.equal((await hodIt.req('POST', '/api/auth/admin/login', { email: 'hod.it@sies.edu.in', password: 'Hod@2026' })).status, 200);
    forms = (await admin.req('GET', '/api/admin/forms')).body.forms;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await db.end();
  });

  // ------------------------------------------------------------ access

  it('serves a health check and refuses anonymous access', async () => {
    const anon = new Client(base);
    assert.equal((await anon.req('GET', '/api/health')).status, 200);
    assert.equal((await anon.req('GET', '/api/student/dashboard')).status, 401);
    assert.equal((await anon.req('GET', '/api/admin/overview')).status, 401);
    assert.equal((await anon.req('POST', '/api/admin/analysis', {})).status, 401);
    assert.equal((await anon.req('POST', '/api/ai/generate-questions', {})).status, 401);
    assert.equal((await anon.req('GET', '/api/nope')).status, 404);
  });

  it('rejects forged, foreign and wrong-kind login cookies', async () => {
    const [{ rows }] = [await db.query(`select id from students where roll_number = '24CS002'`)];
    const id = rows[0].id;
    const forged = (token: string) => {
      const c = new Client(base);
      c.cookies.set('sies_student', token);
      return c.req('GET', '/api/student/dashboard');
    };
    assert.equal((await forged('garbage')).status, 401);
    assert.equal((await forged(jwt.sign({ sub: id, kind: 'student' }, 'some-other-secret-some-other-secret'))).status, 401);
    assert.equal((await forged(jwt.sign({ sub: id, kind: 'admin' }, process.env.JWT_SECRET!))).status, 401);
    assert.equal((await forged(jwt.sign({ sub: id, kind: 'student' }, process.env.JWT_SECRET!, { algorithm: 'HS512' }))).status, 401);
    // a student login cookie never works on admin routes
    const s = await studentClient('24CS002');
    assert.equal((await s.req('GET', '/api/admin/overview')).status, 401);
  });

  // ------------------------------------------------------------- login

  it('logs students in with a safe cookie and the same error for a wrong roll number or password', async () => {
    const c = new Client(base);
    const bad = await c.req('POST', '/api/auth/student/login', { rollNumber: '24CS002', password: 'wrong-password' });
    const unknown = await c.req('POST', '/api/auth/student/login', { rollNumber: 'NOSUCH99', password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(bad.body.error, unknown.body.error);

    const ok = await c.req('POST', '/api/auth/student/login', { rollNumber: '24cs002', password: 'Password@123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.student.rollNumber, '24CS002');
    assert.equal(ok.body.student.password, undefined);
    assert.equal(ok.body.student.password_hash, undefined);
    const cookie = ok.setCookies.find((x) => x.startsWith('sies_student='))!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it('forces a password change before a first-time student can do anything else', async () => {
    const c = new Client(base);
    const login = await c.req('POST', '/api/auth/student/login', { rollNumber: '24CS001', password: 'Password@123' });
    assert.equal(login.body.mustChangePassword, true);

    const dash = await c.req('GET', '/api/student/dashboard');
    assert.equal(dash.status, 403);
    assert.equal(dash.body.code, 'PASSWORD_CHANGE_REQUIRED');

    assert.equal((await c.req('POST', '/api/auth/student/change-password', { currentPassword: 'nope-nope', newPassword: 'Another@1234' })).status, 400);
    assert.equal((await c.req('POST', '/api/auth/student/change-password', { currentPassword: 'Password@123', newPassword: 'short' })).status, 400);
    assert.equal((await c.req('POST', '/api/auth/student/change-password', { currentPassword: 'Password@123', newPassword: 'Password@123' })).status, 400);
    assert.equal((await c.req('POST', '/api/auth/student/change-password', { currentPassword: 'Password@123', newPassword: 'Another@1234' })).status, 200);

    assert.equal((await c.req('GET', '/api/student/dashboard')).status, 200);
    // the old password no longer works, the new one does
    assert.equal((await new Client(base).req('POST', '/api/auth/student/login', { rollNumber: '24CS001', password: 'Password@123' })).status, 401);
    assert.equal((await new Client(base).req('POST', '/api/auth/student/login', { rollNumber: '24CS001', password: 'Another@1234' })).status, 200);
  });

  it('stops repeated wrong passwords for one account but not other accounts', async () => {
    const c = new Client(base);
    let last = 0;
    for (let i = 0; i < 9; i++) {
      last = (await c.req('POST', '/api/auth/student/login', { rollNumber: 'RATELIMIT1', password: 'x'.repeat(10) })).status;
    }
    assert.equal(last, 429);
    // a different student on the same network is not blocked
    assert.equal((await new Client(base).req('POST', '/api/auth/student/login', { rollNumber: '24CS002', password: 'Password@123' })).status, 200);
  });

  // --------------------------------------------------------- dashboard

  it('shows each student the right state', async () => {
    const state = async (roll: string) => (await (await studentClient(roll)).req('GET', '/api/student/dashboard')).body;

    const open = await state('24CS002');
    assert.equal(open.feedbackState, 'open');
    assert.equal(open.form.questions.length, 8);
    assert.equal(open.subjects.length, 5);
    assert.ok(open.subjects.every((s: Json) => s.assignmentId));

    assert.equal((await state('24CS003')).feedbackState, 'not_eligible'); // 68% attendance
    assert.equal((await state('24IT001')).feedbackState, 'closed');

    const submitted = await state('24CS004');
    assert.equal(submitted.feedbackState, 'submitted');
    assert.match(submitted.submissionRecord.referenceId, /^SIES-EV-/);
  });

  // ------------------------------------------------------------ submit

  it('refuses incomplete, tampered, wrong-class, ineligible and closed submissions', async () => {
    const s = await studentClient('24CS002');
    const dash = (await s.req('GET', '/api/student/dashboard')).body;
    const url = `/api/student/feedback/${dash.form.id}/submit`;
    const good = () => entriesFor(dash);

    // one answer missing
    const missing = good();
    delete missing[0].ratings[dash.form.questions[0].id];
    assert.equal((await s.req('POST', url, { entries: missing })).status, 422);
    // out-of-range and non-integer ratings
    const six = good();
    six[0].ratings[dash.form.questions[0].id] = 6;
    assert.equal((await s.req('POST', url, { entries: six })).status, 422);
    const half = good();
    half[0].ratings[dash.form.questions[0].id] = 3.5;
    assert.equal((await s.req('POST', url, { entries: half })).status, 422);
    // a teacher left out
    assert.equal((await s.req('POST', url, { entries: good().slice(1) })).status, 422);
    // a teacher that is not on this form
    const foreign = good();
    foreign[0].teacherId = (await db.query(`select id from teachers where name = 'Dr. Shalini Rao'`)).rows[0].id;
    assert.equal((await s.req('POST', url, { entries: foreign })).status, 422);
    // the same teacher twice
    const dup = good();
    dup[1] = { ...dup[0] };
    assert.equal((await s.req('POST', url, { entries: dup })).status, 422);
    // comment too long
    const long = good();
    long[0].comment = 'x'.repeat(501);
    assert.equal((await s.req('POST', url, { entries: long })).status, 400);

    // another class's form
    const other = formFor('TY B.Sc. Computer Science', 'Semester V');
    const wrong = await s.req('POST', `/api/student/feedback/${other.id}/submit`, { entries: good() });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, 'WRONG_CLASS');

    // below the attendance minimum
    const low = await studentClient('24CS003');
    const lowForm = (await low.req('GET', '/api/student/dashboard')).body;
    const lowRes = await low.req('POST', `/api/student/feedback/${lowForm.form.id}/submit`, { entries: entriesFor(lowForm) });
    assert.equal(lowRes.status, 403);
    assert.equal(lowRes.body.code, 'NOT_ELIGIBLE');

    // closed form
    const closed = await studentClient('24IT001');
    const closedDash = (await closed.req('GET', '/api/student/dashboard')).body;
    const closedRes = await closed.req('POST', `/api/student/feedback/${closedDash.form.id}/submit`, { entries: entriesFor(closedDash) });
    assert.equal(closedRes.status, 409);
    assert.equal(closedRes.body.code, 'FORM_CLOSED');

    // nothing was saved by any refused attempt
    const saved = await db.query(`select count(*)::int n from submissions where form_id = $1`, [dash.form.id]);
    assert.equal(saved.rows[0].n, 1); // only the seeded "already submitted" student
  });

  it('accepts a complete submission once, stores it anonymously, and refuses a second', async () => {
    const s = await studentClient('24CS002');
    const dash = (await s.req('GET', '/api/student/dashboard')).body;
    const url = `/api/student/feedback/${dash.form.id}/submit`;
    const before = (await db.query(`select count(*)::int n from responses where form_id = $1`, [dash.form.id])).rows[0].n;

    const first = await s.req('POST', url, { entries: entriesFor(dash, 5) });
    assert.equal(first.status, 201);
    assert.match(first.body.referenceId, /^SIES-EV-\d{2}-[A-Z2-9]{10}$/);

    const second = await s.req('POST', url, { entries: entriesFor(dash, 1) });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'ALREADY_SUBMITTED');

    const after = (await db.query(`select count(*)::int n from responses where form_id = $1`, [dash.form.id])).rows[0].n;
    assert.equal(after - before, 5, 'one response row per teacher, and the second attempt added none');

    const ratings = await db.query(
      `select count(*)::int n, min(rr.score)::int lo from response_ratings rr
         join responses r on r.id = rr.response_id
        where r.form_id = $1 and r.submitted_on = current_date and rr.score = 5`,
      [dash.form.id]
    );
    assert.ok(ratings.rows[0].n >= 40);

    // nothing in the answer tables can point back to a student
    const cols = await db.query(
      `select column_name from information_schema.columns
        where table_name in ('responses','response_ratings') and column_name ilike '%student%'`
    );
    assert.equal(cols.rows.length, 0);

    const dashAfter = (await s.req('GET', '/api/student/dashboard')).body;
    assert.equal(dashAfter.feedbackState, 'submitted');
    assert.equal(dashAfter.submissionRecord.referenceId, first.body.referenceId);
  });

  it('lets exactly one of two simultaneous submissions through', async () => {
    const s = await studentClient('24CS001', 'Another@1234');
    const dash = (await s.req('GET', '/api/student/dashboard')).body;
    const url = `/api/student/feedback/${dash.form.id}/submit`;
    const statuses = (await Promise.all([
      s.req('POST', url, { entries: entriesFor(dash) }),
      s.req('POST', url, { entries: entriesFor(dash) }),
    ])).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
    const rows = await db.query(
      `select count(*)::int n from submissions su join students st on st.id = su.student_id
        where st.roll_number = '24CS001' and su.form_id = $1`,
      [dash.form.id]
    );
    assert.equal(rows.rows[0].n, 1);
  });

  // ------------------------------------------------------ staff roles

  it('keeps HODs out of admin screens but lets them see analysis', async () => {
    assert.equal((await admin.req('GET', '/api/admin/overview')).status, 200);
    assert.equal((await hodCs.req('GET', '/api/admin/overview')).status, 403);
    assert.equal((await hodCs.req('GET', '/api/admin/classes')).status, 403);
    assert.equal((await hodCs.req('GET', '/api/admin/students')).status, 403);
    assert.equal((await hodCs.req('POST', '/api/admin/forms', {})).status, 403);
    assert.equal((await hodCs.req('POST', '/api/ai/generate-questions', {})).status, 403);
    assert.equal((await hodCs.req('POST', '/api/admin/analysis', {})).status, 200);
  });

  // ---------------------------------------------------------- analysis

  it('hides any teacher with fewer than 5 responses and computes correct averages', async () => {
    const r = await admin.req('POST', '/api/admin/analysis', { academicYear: 'ALL', level: 'ALL', semester: 'ALL', course: 'ALL' });
    assert.equal(r.status, 200);
    const report = r.body;

    assert.ok(report.teacherRankings.length > 0);
    assert.ok(report.teacherRankings.every((t: Json) => t.responseCount >= 5));
    assert.ok(report.summary.hiddenTeachersCount >= 1);
    assert.ok(report.hiddenTeachersNotice.every((h: Json) => h.responseCount < 5));
    assert.equal(report.summary.visibleTeachersCount, report.teacherRankings.length);

    // recompute one teacher's average straight from the stored ratings
    const t = report.teacherRankings[0];
    const check = await db.query(
      `select round(avg(rr.score)::numeric, 2)::float as avg, count(distinct r.id)::int as n
         from response_ratings rr
         join responses r on r.id = rr.response_id
         join assignments a on a.id = r.assignment_id
         join subjects s on s.id = a.subject_id
         join teachers te on te.id = a.teacher_id
        where te.id = $1 and s.code = $2`,
      [t.teacherId, t.subjectCode]
    );
    assert.equal(t.averageScore, check.rows[0].avg);
    assert.equal(t.responseCount, check.rows[0].n);
    assert.equal(t.distribution.reduce((a: number, b: number) => a + b, 0), t.responseCount * 8);

    // sorted best first
    const scores = report.teacherRankings.map((x: Json) => x.averageScore);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));

    // the notebook roll-up: per-class averages and one overall average per teacher
    assert.ok(report.teacherSummaries.length > 0);
    const sum = report.teacherSummaries.find((x: Json) => x.teacherId === t.teacherId);
    assert.ok(sum.classes.length >= 1);
    assert.ok(sum.overallAverage >= 1 && sum.overallAverage <= 5);

    // a filter really filters
    const ty = await admin.req('POST', '/api/admin/analysis', { academicYear: 'ALL', level: 'TY', semester: 'ALL', course: 'ALL' });
    assert.ok(ty.body.teacherRankings.every((x: Json) => x.level === 'TY'));
  });

  it('scopes an HOD to their own course no matter what the browser asks for', async () => {
    const cs = await hodCs.req('POST', '/api/admin/analysis', { academicYear: 'ALL', level: 'ALL', semester: 'ALL', course: 'B.Sc. Information Technology' });
    assert.ok(cs.body.teacherRankings.length > 0);
    assert.ok(cs.body.teacherRankings.every((x: Json) => x.course === 'B.Sc. Computer Science'));
    assert.ok(cs.body.classResponseRates.every((x: Json) => x.course === 'B.Sc. Computer Science'));

    const it = await hodIt.req('POST', '/api/admin/analysis', { academicYear: 'ALL', level: 'ALL', semester: 'ALL', course: 'ALL' });
    assert.ok(it.body.teacherRankings.every((x: Json) => x.course === 'B.Sc. Information Technology'));
    assert.ok(it.body.hiddenTeachersNotice.every((h: Json) => !/Krishnan|Parikh/.test(h.teacherName)));

    const filters = await hodIt.req('GET', '/api/admin/analysis/filters');
    assert.deepEqual(filters.body.courses, ['B.Sc. Information Technology']);
    const all = await admin.req('GET', '/api/admin/analysis/filters');
    assert.ok(all.body.courses.length > 1);
  });

  // ------------------------------------------------------- assignments

  it('supports two teachers on one subject, rated separately, and protects teachers who have feedback', async () => {
    const subject = (await db.query(`select id, class_id, semester from subjects where code = 'CS101'`)).rows[0];
    const second = (await db.query(`select id from teachers where name = 'Prof. Kavita Sawant'`)).rows[0].id;

    const add = await admin.req('POST', '/api/admin/assignments', {
      classId: subject.class_id, semester: subject.semester, subjectId: subject.id,
      teacherId: second, academicYear: '2026-27', addAnother: true,
    });
    assert.equal(add.status, 201);

    const s = await studentClient('25CS012');
    const dash = (await s.req('GET', '/api/student/dashboard')).body;
    const rows = dash.subjects.filter((x: Json) => x.subjectId === subject.id);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].assignmentId, rows[1].assignmentId);
    assert.notEqual(rows[0].teacherId, rows[1].teacherId);

    // all three teachers must be rated, with different scores per teacher
    const entries = dash.subjects.map((x: Json, i: number) => ({
      subjectId: x.subjectId, teacherId: x.teacherId,
      ratings: Object.fromEntries(dash.form.questions.map((q: Json) => [q.id, (i % 5) + 1])),
    }));
    assert.equal((await s.req('POST', `/api/student/feedback/${dash.form.id}/submit`, { entries })).status, 201);
    const stored = await db.query(
      `select a.id, round(avg(rr.score), 1)::float avg from responses r
         join response_ratings rr on rr.response_id = r.id
         join assignments a on a.id = r.assignment_id
        where a.subject_id = $1 group by a.id order by avg`, [subject.id]);
    assert.equal(stored.rows.length, 2);
    assert.notEqual(stored.rows[0].avg, stored.rows[1].avg);

    // replacing or removing a teacher who already has feedback is refused
    const sy = (await db.query(`select id, class_id, semester from subjects where code = 'CS301'`)).rows[0];
    const replace = await admin.req('POST', '/api/admin/assignments', {
      classId: sy.class_id, semester: sy.semester, subjectId: sy.id, teacherId: second, academicYear: '2026-27',
    });
    assert.equal(replace.status, 409);
    const asg = (await db.query(`select id from assignments where subject_id = $1`, [sy.id])).rows[0].id;
    assert.equal((await admin.req('DELETE', `/api/admin/assignments/${asg}`)).status, 409);
    // a class with feedback cannot be deleted
    assert.equal((await admin.req('DELETE', `/api/admin/classes/${sy.class_id}`)).status, 409);
  });

  // ------------------------------------------------------------- forms

  it('prevents duplicate forms and locks questions once a form is open', async () => {
    const sy = formFor('SY B.Sc. Computer Science', 'Semester III');
    const payload = (over: Json = {}) => ({
      id: sy.id, title: sy.title, classId: sy.classId, semester: sy.semester, academicYear: sy.academicYear,
      minAttendance: sy.minAttendance, openDate: sy.openDate, closeDate: sy.closeDate, status: 'open',
      questions: sy.questions.map((q: Json) => ({ category: q.category, text: q.text })), ...over,
    });

    const changed = payload();
    changed.questions[0].text = 'A completely different question text.';
    const locked = await admin.req('POST', '/api/admin/forms', changed);
    assert.equal(locked.status, 409);
    assert.equal(locked.body.code, 'QUESTIONS_LOCKED');

    assert.equal((await admin.req('POST', '/api/admin/forms', payload({ title: 'Renamed form', minAttendance: 70 }))).status, 200);
    assert.equal((await admin.req('POST', '/api/admin/forms', payload({ status: 'draft' }))).status, 409); // has feedback

    const dup = await admin.req('POST', '/api/admin/forms', { ...payload(), id: undefined });
    assert.equal(dup.status, 409);

    const bad = await admin.req('POST', '/api/admin/forms', payload({ closeDate: '2020-01-01' }));
    assert.equal(bad.status, 422);
  });

  it('only opens a form that has questions and teachers, and closing stops submissions', async () => {
    const ty = (await db.query(`select id from classes where name = 'TY B.Sc. Computer Science'`)).rows[0].id;
    const draft = await admin.req('POST', '/api/admin/forms', {
      title: '', classId: ty, semester: 'Semester VI', academicYear: '2026-27', minAttendance: 75,
      openDate: '2026-12-01', closeDate: '2026-12-20', status: 'draft',
      questions: [{ category: 'Clarity & Communication', text: 'Concepts are explained clearly.' }],
    });
    assert.equal(draft.status, 201);
    assert.match(draft.body.title, /Faculty Evaluation/);
    const noTeachers = await admin.req('PATCH', `/api/admin/forms/${draft.body.id}/status`, { status: 'open' });
    assert.equal(noTeachers.status, 422);
    assert.equal(noTeachers.body.code, 'NO_TEACHERS');

    // a draft's questions can still be edited
    const edit = await admin.req('POST', '/api/admin/forms', {
      id: draft.body.id, title: draft.body.title, classId: ty, semester: 'Semester VI', academicYear: '2026-27',
      minAttendance: 80, openDate: '2026-12-01', closeDate: '2026-12-20', status: 'draft',
      questions: [
        { category: 'Clarity & Communication', text: 'Concepts are explained clearly.' },
        { category: 'Classroom Engagement', text: 'Students are encouraged to ask questions.' },
      ],
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.questions.length, 2);

    // closing the FY form stops a student who has not submitted
    const fy = formFor('PG-I M.Sc. Computer Science', 'Semester I');
    const s = await studentClient('26PG004');
    const dash = (await s.req('GET', '/api/student/dashboard')).body;
    assert.equal(dash.feedbackState, 'open');
    assert.equal((await admin.req('PATCH', `/api/admin/forms/${fy.id}/status`, { status: 'closed' })).status, 200);
    assert.equal((await s.req('GET', '/api/student/dashboard')).body.feedbackState, 'closed');
    const late = await s.req('POST', `/api/student/feedback/${fy.id}/submit`, { entries: entriesFor(dash) });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'FORM_CLOSED');
  });

  it('does not show a form before its opening date', async () => {
    const tyit = formFor('TY B.Sc. Information Technology', 'Semester V');
    await db.query(`update forms set status = 'open', open_date = current_date + 3, close_date = current_date + 10 where id = $1`, [tyit.id]);
    const dash = (await (await studentClient('24IT001')).req('GET', '/api/student/dashboard')).body;
    assert.equal(dash.feedbackState, 'none');
    assert.equal(dash.form, null);
  });

  // ------------------------------------------------------------ import

  it('imports students, skips bad rows with reasons, and never resets an existing password', async () => {
    const rows = [
      { rowNumber: 2, rollNumber: 'TST001', name: 'Test Student', className: 'SY B.Sc. Computer Science', semester: 'Semester III', attendancePercent: 90 },
      { rowNumber: 3, rollNumber: 'TST002', name: 'Bad Percent', className: 'SY B.Sc. Computer Science', semester: 'Semester III', attendancePercent: 150 },
      { rowNumber: 4, rollNumber: 'TST003', name: 'No Class', className: 'No Such Class', semester: 'Semester III', attendancePercent: 80 },
      { rowNumber: 5, rollNumber: 'TST004', name: 'Wrong Semester', className: 'SY B.Sc. Computer Science', semester: 'Semester V', attendancePercent: 80 },
      { rowNumber: 6, rollNumber: 'bad roll!', name: 'Odd Roll', className: 'SY B.Sc. Computer Science', semester: 'Semester III', attendancePercent: 80 },
    ];
    const first = await admin.req('POST', '/api/admin/students/import', { rows });
    assert.equal(first.status, 200);
    assert.equal(first.body.importedCount, 1);
    assert.equal(first.body.updatedCount, 0);
    assert.deepEqual(first.body.skipped.map((x: Json) => x.rowNumber).sort(), [3, 4, 5, 6]);
    assert.ok(first.body.skipped.every((x: Json) => x.errors.length > 0));

    // the new student logs in with the starting password and must change it
    const c = new Client(base);
    const login = await c.req('POST', '/api/auth/student/login', { rollNumber: 'TST001', password: 'Password@123' });
    assert.equal(login.body.mustChangePassword, true);
    assert.equal((await c.req('POST', '/api/auth/student/change-password', { currentPassword: 'Password@123', newPassword: 'Mine@123456' })).status, 200);

    // importing the same roll number again updates attendance but keeps their own password
    rows[0].attendancePercent = 55;
    const again = await admin.req('POST', '/api/admin/students/import', { rows: [rows[0]] });
    assert.equal(again.body.importedCount, 0);
    assert.equal(again.body.updatedCount, 1);
    const stu = (await admin.req('GET', '/api/admin/students')).body.students.find((x: Json) => x.rollNumber === 'TST001');
    assert.equal(stu.attendancePercent, 55);
    assert.equal(stu.mustChangePassword, false);
    assert.equal((await new Client(base).req('POST', '/api/auth/student/login', { rollNumber: 'TST001', password: 'Mine@123456' })).status, 200);
  });

  // --------------------------------------------------------- catalogue

  it('manages classes, subjects and teachers with clear errors', async () => {
    const cls = await admin.req('POST', '/api/admin/classes', {
      name: 'FY B.Com. Test', level: 'FY', course: 'B.Com.', division: 'A', semesters: ['Semester I', 'Semester II'],
    });
    assert.equal(cls.status, 201);
    assert.equal((await admin.req('POST', '/api/admin/classes', { name: 'FY B.Com. Test', level: 'FY', course: 'B.Com.', semesters: ['Semester I'] })).status, 409);
    assert.equal((await admin.req('POST', '/api/admin/classes', { name: 'X', level: 'ZZ', course: 'B.Com.', semesters: ['Semester I'] })).status, 400);

    const sub = await admin.req('POST', '/api/admin/subjects', { code: 'bc101', name: 'Financial Accounting', classId: cls.body.id, semester: 'Semester I', credits: 4 });
    assert.equal(sub.status, 201);
    assert.equal(sub.body.code, 'BC101');
    assert.equal((await admin.req('POST', '/api/admin/subjects', { code: 'BC101', name: 'Again', classId: cls.body.id, semester: 'Semester I', credits: 4 })).status, 409);
    assert.equal((await admin.req('POST', '/api/admin/subjects', { code: 'BC999', name: 'Bad Sem', classId: cls.body.id, semester: 'Semester V', credits: 4 })).status, 422);

    const t = await admin.req('POST', '/api/admin/teachers', {
      employeeCode: 'SIES-T900', name: 'Prof. Test Teacher', department: 'Commerce', designation: 'Lecturer', email: 'test@sies.edu.in',
    });
    assert.equal(t.status, 201);
    assert.equal(t.body.active, true);
    assert.equal((await admin.req('POST', '/api/admin/teachers', { employeeCode: 'SIES-T900', name: 'Dup', department: 'x1', designation: 'y1', email: 'a@b.co' })).status, 409);
    const upd = await admin.req('PUT', `/api/admin/teachers/${t.body.id}`, { ...t.body, designation: 'Senior Lecturer', active: false });
    assert.equal(upd.body.designation, 'Senior Lecturer');
    assert.equal(upd.body.active, false);
    // an inactive teacher cannot be assigned
    const asg = await admin.req('POST', '/api/admin/assignments', {
      classId: cls.body.id, semester: 'Semester I', subjectId: sub.body.id, teacherId: t.body.id, academicYear: '2026-27',
    });
    assert.equal(asg.status, 422);

    assert.equal((await admin.req('DELETE', `/api/admin/subjects/${sub.body.id}`)).status, 200);
    assert.equal((await admin.req('DELETE', `/api/admin/classes/${cls.body.id}`)).status, 200);
    assert.equal((await admin.req('DELETE', `/api/admin/classes/${cls.body.id}`)).status, 404);
    assert.equal((await admin.req('DELETE', '/api/admin/classes/not-an-id')).status, 400);
  });

  it('reports overview numbers', async () => {
    const o = (await admin.req('GET', '/api/admin/overview')).body;
    assert.equal(o.totalClasses, 6);
    assert.ok(o.totalStudents >= 9);
    assert.ok(o.openFormsCount >= 1);
    assert.ok(o.overallResponseRate > 0);
    assert.ok(Array.isArray(o.recentForms));
  });

  // ---------------------------------------------------------------- AI

  it('lets only administrators generate questions', async () => {
    const student = await studentClient('24CS002');
    assert.equal((await student.req('POST', '/api/ai/generate-questions', {})).status, 401);

    const r = await admin.req('POST', '/api/ai/generate-questions', { className: 'SY B.Sc. Computer Science', semester: 'Semester III' });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'mock');
    assert.equal(r.body.questions.length, 8);
    const allowed = ['Subject Mastery & Preparation', 'Clarity & Communication', 'Classroom Engagement', 'Assessment & Availability'];
    assert.ok(r.body.questions.every((q: Json) => allowed.includes(q.category) && q.text.length > 8));
  });

  it('logs out by clearing the cookie', async () => {
    const s = await studentClient('26PG004');
    assert.equal((await s.req('GET', '/api/student/dashboard')).status, 200);
    await s.req('POST', '/api/auth/student/logout');
    assert.equal((await s.req('GET', '/api/student/dashboard')).status, 401);
  });
});
