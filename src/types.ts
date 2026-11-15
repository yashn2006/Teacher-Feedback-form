export type ClassLevel = 'FY' | 'SY' | 'TY' | 'PG-I' | 'PG-II';

export type FormStatus = 'draft' | 'open' | 'closed';

export type FeedbackState = 'open' | 'not_eligible' | 'submitted' | 'closed' | 'none';

export type AdminRole = 'admin' | 'hod';

export interface AcademicClass {
  id: string;
  name: string;
  level: ClassLevel;
  course: string;
  division: string;
  semesters: string[];
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  classId: string;
  semester: string;
  credits: number;
}

export interface Teacher {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  email: string;
  active: boolean;
}

export interface TeachingAssignment {
  id: string;
  classId: string;
  semester: string;
  subjectId: string;
  teacherId: string;
  academicYear: string;
}

export interface StudentRecord {
  id: string;
  rollNumber: string;
  name: string;
  classId: string;
  className: string;
  course: string;
  level: ClassLevel;
  semester: string;
  attendancePercent: number;
  attendedClasses: number;
  totalClasses: number;
  mustChangePassword: boolean;
  password: string;
  submittedFormIds: string[];
  submissionRecords?: Record<string, { submittedAt: string; referenceId: string }>;
}

export interface EvaluationQuestion {
  id: string;
  category: string;
  text: string;
  order: number;
}

export interface EvaluationForm {
  id: string;
  title: string;
  classId: string;
  className: string;
  course: string;
  level: ClassLevel;
  semester: string;
  academicYear: string;
  minAttendance: number;
  openDate: string;
  closeDate: string;
  status: FormStatus;
  questions: EvaluationQuestion[];
  eligibleCount: number;
  submittedCount: number;
}

export interface SubjectTeacherPair {
  /** One row per teacher. A subject with two teachers appears twice, with different assignmentIds. */
  assignmentId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  teacherDesignation: string;
  teacherDepartment: string;
}

export interface StudentDashboardPayload {
  student: Omit<StudentRecord, 'password'>;
  form: EvaluationForm | null;
  feedbackState: FeedbackState;
  subjects: SubjectTeacherPair[];
  submissionRecord?: { submittedAt: string; referenceId: string };
}

export interface FeedbackDraft {
  formId: string;
  rollNumber: string;
  // answers[assignmentId][questionId] = 1..5
  answers: Record<string, Record<string, number>>;
  // comments[assignmentId] = string
  comments: Record<string, string>;
  updatedAt: string;
}

export interface SubmittedFeedbackEntry {
  subjectId: string;
  teacherId: string;
  ratings: Record<string, number>;
  comment?: string;
}

export interface StoredResponseRecord {
  id: string;
  formId: string;
  classId: string;
  className: string;
  course: string;
  level: ClassLevel;
  semester: string;
  academicYear: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  department: string;
  submittedAt: string;
  ratings: Array<{ category: string; score: number }>;
  comment?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  course?: string; // Mandatory for HOD; undefined for admin
  designation: string;
  password: string;
}

export interface AnalysisFilters {
  academicYear: string;
  level: ClassLevel | 'ALL';
  semester: string;
  course: string;
}

export interface TeacherAnalysisItem {
  teacherId: string;
  teacherName: string;
  department: string;
  subjectCode: string;
  subjectName: string;
  className: string;
  level: ClassLevel;
  course: string;
  semester: string;
  responseCount: number;
  averageScore: number;
  categoryAverages: Record<string, number>;
  distribution: [number, number, number, number, number];
  comments: Array<{ submittedAt: string; text: string }>;
}

/** Notebook view: one teacher, the average in each class they teach, then one overall average. */
export interface TeacherSummaryItem {
  teacherId: string;
  teacherName: string;
  department: string;
  overallAverage: number;
  responseCount: number;
  classes: Array<{
    classId: string;
    className: string;
    level: ClassLevel;
    course: string;
    averageScore: number;
    responseCount: number;
  }>;
}

export interface AnalysisReportPayload {
  teacherSummaries?: TeacherSummaryItem[];
  summary: {
    totalResponses: number;
    totalEligible: number;
    responseRate: number;
    overallAverage: number;
    visibleTeachersCount: number;
    hiddenTeachersCount: number;
  };
  teacherRankings: TeacherAnalysisItem[];
  hiddenTeachersNotice: Array<{
    teacherName: string;
    subjectName: string;
    responseCount: number;
  }>;
  categoryAverages: Array<{ category: string; average: number }>;
  ratingDistribution: Array<{ rating: number; label: string; count: number; percent: number }>;
  classResponseRates: Array<{
    classId: string;
    className: string;
    level: ClassLevel;
    course: string;
    semester: string;
    eligible: number;
    submitted: number;
    rate: number;
  }>;
}

export interface StudentImportRow {
  rowNumber: number;
  rollNumber: string;
  name: string;
  className: string;
  semester: string;
  attendancePercent: number;
  attendedClasses?: number;
  totalClasses?: number;
  valid: boolean;
  errors: string[];
}

export const RATING_SCALE: Array<{ value: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { value: 1, label: 'Poor' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Good' },
  { value: 4, label: 'Very good' },
  { value: 5, label: 'Excellent' },
];

export const QUESTION_CATEGORIES = [
  'Subject Mastery & Preparation',
  'Clarity & Communication',
  'Classroom Engagement',
  'Assessment & Availability',
] as const;

export const CLASS_LEVELS: ClassLevel[] = ['FY', 'SY', 'TY', 'PG-I', 'PG-II'];
