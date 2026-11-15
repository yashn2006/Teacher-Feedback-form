import {
  AcademicClass,
  AdminUser,
  AnalysisFilters,
  AnalysisReportPayload,
  ClassLevel,
  EvaluationForm,
  EvaluationQuestion,
  FeedbackDraft,
  FormStatus,
  StudentDashboardPayload,
  StudentImportRow,
  StudentRecord,
  Subject,
  SubmittedFeedbackEntry,
  Teacher,
  TeachingAssignment,
} from '../types';

export const API_ENDPOINTS = {
  studentLogin: '/api/auth/student/login',
  studentLogout: '/api/auth/student/logout',
  studentChangePassword: '/api/auth/student/change-password',
  studentDashboard: '/api/student/dashboard',
  studentSubmitFeedback: (formId: string) => `/api/student/feedback/${formId}/submit`,
  adminLogin: '/api/auth/admin/login',
  adminLogout: '/api/auth/admin/logout',
  adminOverview: '/api/admin/overview',
  classes: '/api/admin/classes',
  classById: (id: string) => `/api/admin/classes/${id}`,
  subjects: '/api/admin/subjects',
  subjectById: (id: string) => `/api/admin/subjects/${id}`,
  teachers: '/api/admin/teachers',
  teacherById: (id: string) => `/api/admin/teachers/${id}`,
  assignments: '/api/admin/assignments',
  assignmentById: (id: string) => `/api/admin/assignments/${id}`,
  students: '/api/admin/students',
  studentsImport: '/api/admin/students/import',
  forms: '/api/admin/forms',
  formStatus: (id: string) => `/api/admin/forms/${id}/status`,
  aiGenerateQuestions: '/api/ai/generate-questions',
  analysis: '/api/admin/analysis',
  analysisFilters: '/api/admin/analysis/filters',
} as const;

// The login itself is an HttpOnly cookie that the server sets. These two keys only remember the
// signed-in person's profile so pages can show the name instantly. They hold no password or token.
const STUDENT_SESSION_KEY = 'sies_student_session_v1';
const ADMIN_SESSION_KEY = 'sies_admin_session_v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

function sendLogout(url: string) {
  // Best effort: asks the server to clear the login cookie.
  fetch(url, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}

/** The server says the login has expired: forget the profile and go back to the right login page. */
function handleExpiredSession(url: string) {
  const staff = url.startsWith('/api/admin') || url.startsWith('/api/ai');
  const loginPath = staff ? '/admin/login' : '/login';
  if (staff) setAdminSession(null);
  else setStudentSession(null);
  if (typeof window !== 'undefined' && window.location.pathname !== loginPath) {
    window.location.assign(loginPath);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    // A wrong password on the login screens is also a 401, so only react to it elsewhere.
    if (res.status === 401 && !url.startsWith('/api/auth/')) handleExpiredSession(url);
    throw new ApiError(data?.error ?? 'Something went wrong. Please try again.', res.status, data?.code);
  }
  return data as T;
}

// ---------------------------------------------------------------- session helpers

export function getStudentSession(): Omit<StudentRecord, 'password'> | null {
  try {
    const raw = localStorage.getItem(STUDENT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStudentSession(student: Omit<StudentRecord, 'password'> | null) {
  if (!student) {
    localStorage.removeItem(STUDENT_SESSION_KEY);
    sendLogout(API_ENDPOINTS.studentLogout);
  } else {
    localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(student));
  }
}

export function getAdminSession(): Omit<AdminUser, 'password'> | null {
  try {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAdminSession(admin: Omit<AdminUser, 'password'> | null) {
  if (!admin) {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    sendLogout(API_ENDPOINTS.adminLogout);
  } else {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(admin));
  }
}

// ---------------------------------------------------------------- draft autosave
// Half-finished answers are kept in this browser only, so a refresh does not lose them.

function getDraftKey(rollNumber: string, formId: string) {
  return `sies_eval_draft_${rollNumber}_${formId}`;
}

export function getFeedbackDraft(rollNumber: string, formId: string): FeedbackDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(rollNumber, formId));
    return raw ? (JSON.parse(raw) as FeedbackDraft) : null;
  } catch {
    return null;
  }
}

export function saveFeedbackDraft(draft: FeedbackDraft) {
  try {
    localStorage.setItem(getDraftKey(draft.rollNumber, draft.formId), JSON.stringify(draft));
  } catch {
    // Ignore quota issues
  }
}

export function clearFeedbackDraft(rollNumber: string, formId: string) {
  localStorage.removeItem(getDraftKey(rollNumber, formId));
}

// ---------------------------------------------------------------- API

export const api = {
  // ---------------- STUDENT ----------------
  async studentLogin(rollNumber: string, password: string): Promise<{
    student: Omit<StudentRecord, 'password'>;
    mustChangePassword: boolean;
  }> {
    const res = await request<{ student: Omit<StudentRecord, 'password'>; mustChangePassword: boolean }>(
      'POST',
      API_ENDPOINTS.studentLogin,
      { rollNumber, password }
    );
    setStudentSession(res.student);
    return res;
  },

  /** The server knows who is logged in from the cookie, so rollNumber is only kept for the old call shape. */
  async changeStudentPassword(
    _rollNumber: string,
    currentPassword: string,
    newPassword: string
  ): Promise<Omit<StudentRecord, 'password'>> {
    const res = await request<{ student: Omit<StudentRecord, 'password'> }>(
      'POST',
      API_ENDPOINTS.studentChangePassword,
      { currentPassword, newPassword }
    );
    setStudentSession(res.student);
    return res.student;
  },

  async getStudentDashboard(_rollNumber: string): Promise<StudentDashboardPayload> {
    const payload = await request<StudentDashboardPayload>('GET', API_ENDPOINTS.studentDashboard);
    setStudentSession(payload.student);
    return payload;
  },

  async submitStudentFeedback(
    rollNumber: string,
    formId: string,
    entries: SubmittedFeedbackEntry[]
  ): Promise<{ referenceId: string; submittedAt: string }> {
    const result = await request<{ referenceId: string; submittedAt: string }>(
      'POST',
      API_ENDPOINTS.studentSubmitFeedback(formId),
      { entries }
    );
    clearFeedbackDraft(rollNumber, formId);
    // Refresh the saved profile so it shows this form as submitted.
    await api.getStudentDashboard(rollNumber).catch(() => undefined);
    return result;
  },

  // ---------------- ADMIN & HOD ----------------
  async adminLogin(email: string, password: string): Promise<Omit<AdminUser, 'password'>> {
    const admin = await request<Omit<AdminUser, 'password'>>('POST', API_ENDPOINTS.adminLogin, {
      email,
      password,
    });
    setAdminSession(admin);
    return admin;
  },

  getAdminOverview() {
    return request<{
      totalClasses: number;
      totalTeachers: number;
      totalStudents: number;
      openFormsCount: number;
      overallResponseRate: number;
      recentForms: EvaluationForm[];
    }>('GET', API_ENDPOINTS.adminOverview);
  },

  getClassesAndSubjects() {
    return request<{ classes: AcademicClass[]; subjects: Subject[] }>('GET', API_ENDPOINTS.classes);
  },

  createClass(payload: Omit<AcademicClass, 'id'>) {
    return request<AcademicClass>('POST', API_ENDPOINTS.classes, payload);
  },

  async deleteClass(id: string): Promise<void> {
    await request('DELETE', API_ENDPOINTS.classById(id));
  },

  createSubject(payload: Omit<Subject, 'id'>) {
    return request<Subject>('POST', API_ENDPOINTS.subjects, payload);
  },

  async deleteSubject(id: string): Promise<void> {
    await request('DELETE', API_ENDPOINTS.subjectById(id));
  },

  getTeachers() {
    return request<Teacher[]>('GET', API_ENDPOINTS.teachers);
  },

  upsertTeacher(teacher: Omit<Teacher, 'id'> & { id?: string }) {
    const { id, ...body } = teacher;
    return id
      ? request<Teacher>('PUT', API_ENDPOINTS.teacherById(id), body)
      : request<Teacher>('POST', API_ENDPOINTS.teachers, body);
  },

  getAssignments() {
    return request<{
      assignments: TeachingAssignment[];
      classes: AcademicClass[];
      subjects: Subject[];
      teachers: Teacher[];
    }>('GET', API_ENDPOINTS.assignments);
  },

  /**
   * By default the chosen teacher replaces the subject's current teacher.
   * Pass addAnother: true to give a subject a second teacher instead.
   */
  saveAssignment(payload: {
    classId: string;
    semester: string;
    subjectId: string;
    teacherId: string;
    academicYear: string;
    addAnother?: boolean;
  }) {
    return request<TeachingAssignment>('POST', API_ENDPOINTS.assignments, payload);
  },

  async deleteAssignment(id: string): Promise<void> {
    await request('DELETE', API_ENDPOINTS.assignmentById(id));
  },

  getStudents() {
    return request<{ students: Array<Omit<StudentRecord, 'password'>>; classes: AcademicClass[] }>(
      'GET',
      API_ENDPOINTS.students
    );
  },

  importStudentsAttendance(rows: StudentImportRow[]) {
    return request<{
      importedCount: number;
      updatedCount: number;
      skipped: Array<{ rowNumber: number; errors: string[] }>;
    }>('POST', API_ENDPOINTS.studentsImport, { rows: rows.filter((r) => r.valid) });
  },

  getForms() {
    return request<{ forms: EvaluationForm[]; classes: AcademicClass[] }>('GET', API_ENDPOINTS.forms);
  },

  createOrUpdateForm(payload: {
    id?: string;
    title: string;
    classId: string;
    semester: string;
    academicYear: string;
    minAttendance: number;
    openDate: string;
    closeDate: string;
    status: FormStatus;
    questions: EvaluationQuestion[];
  }) {
    return request<EvaluationForm>('POST', API_ENDPOINTS.forms, payload);
  },

  updateFormStatus(formId: string, status: FormStatus) {
    return request<EvaluationForm>('PATCH', API_ENDPOINTS.formStatus(formId), { status });
  },

  async generateQuestionsWithAI(params: {
    className: string;
    semester: string;
    course: string;
    academicYear: string;
  }): Promise<{ questions: EvaluationQuestion[]; source: 'gemini' | 'deepseek' | 'mock' }> {
    const data = await request<{ questions: EvaluationQuestion[]; source: string }>(
      'POST',
      API_ENDPOINTS.aiGenerateQuestions,
      params
    );
    return {
      questions: data.questions,
      source: data.source === 'gemini' || data.source === 'deepseek' ? data.source : 'mock',
    };
  },

  /** An HOD is limited to their own course by the server, whatever filters are sent. */
  getAnalysisReport(
    filters: AnalysisFilters,
    _adminUser: Omit<AdminUser, 'password'>
  ): Promise<AnalysisReportPayload> {
    return request<AnalysisReportPayload>('POST', API_ENDPOINTS.analysis, filters);
  },

  getFilterOptions() {
    return request<{ academicYears: string[]; courses: string[]; semesters: string[]; levels: ClassLevel[] }>(
      'GET',
      API_ENDPOINTS.analysisFilters
    );
  },
};
