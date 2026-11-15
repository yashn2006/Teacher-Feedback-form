import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Edit3,
  Lock,
  Save,
  Send,
} from 'lucide-react';
import {
  api,
  getFeedbackDraft,
  getStudentSession,
  saveFeedbackDraft,
  setStudentSession,
} from '../../services/api';
import { RATING_SCALE, StudentDashboardPayload } from '../../types';
import { StudentHeader } from '../../components/StudentHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateBlocks';

export function StudentFeedbackPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<StudentDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Answers: [assignmentId][questionId] = 1..5 (one set per teacher, even when a subject has two)
  const [answers, setAnswers] = useState<Record<string, Record<string, number>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState<number>(0); // 0..subjects.length-1, or subjects.length for Review
  const [lastSavedText, setLastSavedText] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedReceipt, setSubmittedReceipt] = useState<{
    referenceId: string;
    submittedAt: string;
  } | null>(null);

  const loadForm = useCallback(async () => {
    const session = getStudentSession();
    if (!session || session.mustChangePassword) {
      navigate('/login', { replace: true });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await api.getStudentDashboard(session.rollNumber);
      setData(payload);

      if (payload.form && payload.feedbackState === 'open') {
        const draft = getFeedbackDraft(payload.student.rollNumber, payload.form.id);
        if (draft) {
          setAnswers(draft.answers ?? {});
          setComments(draft.comments ?? {});
          setLastSavedText(
            `Draft restored (${new Date(draft.updatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })})`
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load evaluation form.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  // Autosave to localStorage whenever answers or comments change
  useEffect(() => {
    if (!data?.form || !data?.student || data.feedbackState !== 'open' || submittedReceipt) return;
    if (Object.keys(answers).length === 0 && Object.keys(comments).length === 0) return;

    const now = new Date().toISOString();
    saveFeedbackDraft({
      formId: data.form.id,
      rollNumber: data.student.rollNumber,
      answers,
      comments,
      updatedAt: now,
    });
    setLastSavedText(
      `Autosaved at ${new Date(now).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`
    );
  }, [answers, comments, data, submittedReceipt]);

  const subjects = data?.subjects ?? [];
  const questions = data?.form?.questions ?? [];
  const totalQuestions = subjects.length * questions.length;

  const totalAnswered = useMemo(() => {
    let count = 0;
    for (const sub of subjects) {
      const subAns = answers[sub.assignmentId] ?? {};
      for (const q of questions) {
        if (subAns[q.id]) count++;
      }
    }
    return count;
  }, [answers, subjects, questions]);

  const allQuestionsAnswered = totalQuestions > 0 && totalAnswered === totalQuestions;
  const isReviewPage = activeIndex === subjects.length;
  const currentSubject = !isReviewPage ? subjects[activeIndex] : null;

  function setRating(subjectId: string, questionId: string, value: 1 | 2 | 3 | 4 | 5) {
    setAnswers((prev) => ({
      ...prev,
      [subjectId]: {
        ...(prev[subjectId] ?? {}),
        [questionId]: value,
      },
    }));
  }

  function handleRadioKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    subjectId: string,
    questionId: string,
    currentVal: number | undefined
  ) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentVal ? Math.min(5, currentVal + 1) : 1;
      setRating(subjectId, questionId, next as 1 | 2 | 3 | 4 | 5);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentVal ? Math.max(1, currentVal - 1) : 5;
      setRating(subjectId, questionId, prev as 1 | 2 | 3 | 4 | 5);
    }
  }

  function getSubjectAnsweredCount(subjectId: string): number {
    const subAns = answers[subjectId] ?? {};
    return questions.filter((q) => Boolean(subAns[q.id])).length;
  }

  function getSubjectAverage(subjectId: string): number | null {
    const subAns = answers[subjectId] ?? {};
    const vals = questions.map((q) => subAns[q.id]).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return Math.round((sum / vals.length) * 100) / 100;
  }

  async function handleFinalSubmit() {
    if (!data?.form || !allQuestionsAnswered || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const entries = subjects.map((sub) => ({
        subjectId: sub.subjectId,
        teacherId: sub.teacherId,
        ratings: answers[sub.assignmentId] ?? {},
        comment: comments[sub.assignmentId] ?? '',
      }));
      const receipt = await api.submitStudentFeedback(data.student.rollNumber, data.form.id, entries);
      setSubmittedReceipt(receipt);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit evaluation.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    setStudentSession(null);
    navigate('/login');
  }

  const session = getStudentSession();
  const progressPct = totalQuestions > 0 ? Math.round((totalAnswered / totalQuestions) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[#EDF1F5]">
      <StudentHeader student={data?.student ?? session} onLogout={handleLogout} backToDashboard />

      <main id="main-content" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loading && <LoadingState label="Loading evaluation form and saved draft..." rows={5} />}

        {!loading && error && (
          <ErrorState title="Unable to open evaluation form" message={error} onRetry={loadForm} />
        )}

        {/* Thank-you page immediately after submission */}
        {!loading && !error && submittedReceipt && data && (
          <section
            aria-labelledby="thank-you-heading"
            className="max-w-2xl mx-auto bg-white border border-slate-300 p-6 sm:p-10 text-center"
          >
            <div className="w-14 h-14 mx-auto bg-[#E6F2F3] border border-[#0B6E79] flex items-center justify-center mb-5">
              <CheckCircle2 className="w-7 h-7 text-[#0B6E79]" aria-hidden="true" />
            </div>
            <h1 id="thank-you-heading" className="font-heading text-2xl sm:text-3xl font-bold text-[#0F1B2D]">
              Thank You for Your Feedback
            </h1>
            <p className="text-sm sm:text-base text-slate-700 mt-3">
              Your teacher evaluation for <strong>{data.student.className}</strong> ({data.student.semester}) has
              been submitted anonymously and locked.
            </p>
            <div className="mt-6 p-4 bg-[#EDF1F5] border border-slate-300 text-left text-sm space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">Confirmation Reference</span>
                <span className="font-mono font-semibold text-[#0F1B2D]">{submittedReceipt.referenceId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">Submitted On</span>
                <span className="tabular-nums text-[#0F1B2D]">
                  {new Date(submittedReceipt.submittedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-600">Subjects Evaluated</span>
                <span className="tabular-nums font-semibold text-[#0F1B2D]">{subjects.length}</span>
              </div>
            </div>
            <div className="mt-7">
              <Link
                to="/dashboard"
                className="min-h-[44px] px-6 py-3 bg-[#0B6E79] hover:bg-[#08545D] text-white text-sm font-medium inline-flex items-center justify-center transition-colors"
              >
                Return to Dashboard
              </Link>
            </div>
          </section>
        )}

        {/* Guard: Already submitted / Not eligible / Closed / No form */}
        {!loading && !error && !submittedReceipt && data && data.feedbackState !== 'open' && (
          <section className="max-w-2xl mx-auto bg-white border border-slate-300 p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <Lock className="w-6 h-6 text-[#0F1B2D] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h1 className="font-heading text-xl font-bold text-[#0F1B2D]">
                  {data.feedbackState === 'submitted'
                    ? 'Evaluation Already Submitted'
                    : data.feedbackState === 'not_eligible'
                    ? 'Not Eligible to Submit Feedback'
                    : 'Evaluation Form Unavailable'}
                </h1>
                <p className="text-sm text-slate-700 mt-2">
                  {data.feedbackState === 'submitted'
                    ? 'You have already submitted your response for this term. Submitted forms cannot be reopened.'
                    : data.feedbackState === 'not_eligible'
                    ? `Your attendance (${data.student.attendancePercent}%) is below the required ${
                        data.form?.minAttendance ?? 75
                      }% minimum.`
                    : 'This evaluation form is currently closed or not yet active.'}
                </p>
                <div className="mt-5">
                  <Link
                    to="/dashboard"
                    className="min-h-[44px] px-5 py-2.5 bg-[#0F1B2D] text-white text-sm font-medium inline-flex items-center"
                  >
                    Return to Dashboard
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Active Unified Class Feedback Form */}
        {!loading && !error && !submittedReceipt && data && data.feedbackState === 'open' && data.form && (
          <>
            {subjects.length === 0 ? (
              <EmptyState
                title="No Subjects Assigned"
                description="No teachers have been mapped to your class for this semester yet. Please contact your department administrator."
                actionLabel="Return to Dashboard"
                onAction={() => navigate('/dashboard')}
              />
            ) : (
              <div className="space-y-5">
                {/* Top Progress Bar */}
                <section
                  aria-label="Overall evaluation progress"
                  className="bg-white border border-slate-300 p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
                    <div>
                      <h1 className="font-heading text-lg sm:text-xl font-bold text-[#0F1B2D]">
                        {data.form.title}
                      </h1>
                      <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                        {data.student.className} · {data.student.semester}
                      </p>
                    </div>
                    <div className="flex flex-col sm:items-end gap-1">
                      <span
                        className="font-heading text-sm sm:text-base font-bold text-[#0F1B2D] tabular-nums"
                        aria-live="polite"
                      >
                        {totalAnswered} of {totalQuestions} answered ({progressPct}%)
                      </span>
                      {lastSavedText && (
                        <span className="text-xs text-[#0B6E79] inline-flex items-center gap-1" aria-live="polite">
                          <Save className="w-3.5 h-3.5" aria-hidden="true" />
                          {lastSavedText}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={totalAnswered}
                    aria-valuemin={0}
                    aria-valuemax={totalQuestions}
                    aria-label={`${totalAnswered} of ${totalQuestions} questions answered`}
                    className="h-3 w-full bg-[#EDF1F5] border border-slate-300"
                  >
                    <div
                      className="h-full bg-[#0B6E79] transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </section>

                {/* Two-Column Form Body */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Left Column: Subject List + Review Step */}
                  <nav
                    aria-label="Subjects in this evaluation"
                    className="lg:col-span-4 bg-white border border-slate-300"
                  >
                    <div className="px-4 py-3 border-b border-slate-200 bg-[#0F1B2D] text-white">
                      <h2 className="font-heading text-sm font-semibold">
                        Class Subjects ({subjects.length})
                      </h2>
                    </div>
                    <ul className="divide-y divide-slate-200">
                      {subjects.map((sub, idx) => {
                        const answeredCount = getSubjectAnsweredCount(sub.assignmentId);
                        const isComplete = answeredCount === questions.length;
                        const isActive = activeIndex === idx;
                        return (
                          <li key={sub.assignmentId}>
                            <button
                              type="button"
                              onClick={() => setActiveIndex(idx)}
                              aria-current={isActive ? 'step' : undefined}
                              className={`w-full min-h-[56px] px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                                isActive
                                  ? 'bg-[#E6F2F3] text-[#0F1B2D]'
                                  : 'bg-white hover:bg-slate-50 text-[#0F1B2D]'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">
                                  {sub.subjectCode} · {sub.subjectName}
                                </p>
                                <p className="text-xs text-slate-600 truncate mt-0.5">
                                  {sub.teacherName}
                                </p>
                              </div>
                              <span
                                className={`px-2 py-1 text-xs font-semibold tabular-nums border shrink-0 whitespace-nowrap ${
                                  isComplete
                                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                                    : isActive
                                    ? 'border-[#0B6E79] bg-white text-[#08545D]'
                                    : 'border-slate-300 bg-[#EDF1F5] text-slate-700'
                                }`}
                              >
                                {answeredCount}/{questions.length} answered
                              </span>
                            </button>
                          </li>
                        );
                      })}

                      {/* Review & Submit navigation row */}
                      <li>
                        <button
                          type="button"
                          onClick={() => setActiveIndex(subjects.length)}
                          aria-current={isReviewPage ? 'step' : undefined}
                          className={`w-full min-h-[52px] px-4 py-3 text-left flex items-center justify-between gap-3 font-medium transition-colors cursor-pointer ${
                            isReviewPage
                              ? 'bg-[#0B6E79] text-white'
                              : 'bg-slate-50 hover:bg-slate-100 text-[#0F1B2D]'
                          }`}
                        >
                          <span className="text-sm font-heading font-semibold">Review and submit</span>
                          <ChevronRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                        </button>
                      </li>
                    </ul>
                  </nav>

                  {/* Right Column: Active Subject OR Final Review & Submit */}
                  <section className="lg:col-span-8 bg-white border border-slate-300 p-5 sm:p-7">
                    {!isReviewPage && currentSubject ? (
                      <div>
                        <div className="pb-5 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-[#0B6E79] uppercase tracking-wider">
                              Subject {activeIndex + 1} of {subjects.length} · {currentSubject.subjectCode}
                            </p>
                            <h2 className="font-heading text-xl sm:text-2xl font-bold text-[#0F1B2D] mt-1">
                              {currentSubject.subjectName}
                            </h2>
                            <p className="text-sm text-slate-700 mt-1">
                              Faculty: <strong className="text-[#0F1B2D]">{currentSubject.teacherName}</strong>{' '}
                              <span className="text-slate-500">({currentSubject.teacherDesignation})</span>
                            </p>
                          </div>
                          <span className="px-3 py-1.5 border border-slate-300 bg-[#EDF1F5] text-xs font-semibold text-[#0F1B2D] tabular-nums whitespace-nowrap">
                            {getSubjectAnsweredCount(currentSubject.assignmentId)}/{questions.length} answered
                          </span>
                        </div>

                        {/* Questions */}
                        <div className="divide-y divide-slate-200">
                          {questions.map((q, qIdx) => {
                            const selectedVal = answers[currentSubject.assignmentId]?.[q.id];
                            return (
                              <fieldset key={q.id} className="py-5">
                                <legend className="text-sm sm:text-base font-medium text-[#0F1B2D] leading-snug">
                                  <span className="font-mono text-xs text-slate-500 mr-2">
                                    Q{qIdx + 1}.
                                  </span>
                                  {q.text}
                                </legend>
                                <p className="text-xs text-slate-500 mt-1">{q.category}</p>

                                <div
                                  role="radiogroup"
                                  aria-label={`Question ${qIdx + 1}: ${q.text}`}
                                  className="mt-3.5 grid grid-cols-2 sm:grid-cols-5 gap-2"
                                >
                                  {RATING_SCALE.map((opt) => {
                                    const isSelected = selectedVal === opt.value;
                                    return (
                                      <button
                                        key={opt.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={isSelected}
                                        onClick={() =>
                                          setRating(currentSubject.assignmentId, q.id, opt.value)
                                        }
                                        onKeyDown={(e) =>
                                          handleRadioKeyDown(
                                            e,
                                            currentSubject.assignmentId,
                                            q.id,
                                            selectedVal
                                          )
                                        }
                                        className={`min-h-[48px] px-2.5 py-2 border text-left sm:text-center flex sm:flex-col items-center justify-between sm:justify-center gap-1 transition-colors cursor-pointer ${
                                          isSelected
                                            ? 'bg-[#0B6E79] border-[#0B6E79] text-white'
                                            : 'bg-white border-slate-300 text-[#0F1B2D] hover:border-[#0B6E79] hover:bg-[#E6F2F3]'
                                        }`}
                                      >
                                        <span className="font-heading text-sm font-bold tabular-nums">
                                          {opt.value}
                                        </span>
                                        <span className="text-xs font-medium leading-tight">
                                          {opt.label}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            );
                          })}
                        </div>

                        {/* Optional Comment Box per Teacher */}
                        <div className="pt-5 border-t border-slate-200">
                          <label
                            htmlFor={`comment-${currentSubject.assignmentId}`}
                            className="block text-sm font-medium text-[#0F1B2D] mb-1.5"
                          >
                            Optional Comment for {currentSubject.teacherName}
                          </label>
                          <textarea
                            id={`comment-${currentSubject.assignmentId}`}
                            rows={3}
                            maxLength={500}
                            value={comments[currentSubject.assignmentId] ?? ''}
                            onChange={(e) =>
                              setComments((prev) => ({
                                ...prev,
                                [currentSubject.assignmentId]: e.target.value,
                              }))
                            }
                            placeholder="Share constructive feedback on teaching style, pace, or lab guidance (optional)..."
                            className="w-full p-3 bg-white border border-slate-400 text-sm text-[#0F1B2D] placeholder:text-slate-400 focus:border-[#0B6E79]"
                          />
                          <p className="text-xs text-slate-500 mt-1 text-right tabular-nums">
                            {(comments[currentSubject.assignmentId] ?? '').length}/500 characters
                          </p>
                        </div>

                        {/* Back / Next Footer */}
                        <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            disabled={activeIndex === 0}
                            onClick={() => {
                              setActiveIndex((prev) => Math.max(0, prev - 1));
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="min-h-[44px] px-4 py-2.5 border border-slate-400 bg-white text-[#0F1B2D] text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 cursor-pointer"
                          >
                            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                            <span>Back</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActiveIndex((prev) => Math.min(subjects.length, prev + 1));
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="min-h-[44px] px-5 py-2.5 bg-[#0B6E79] hover:bg-[#08545D] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                          >
                            <span>
                              {activeIndex === subjects.length - 1
                                ? 'Review and submit'
                                : 'Next subject'}
                            </span>
                            <ArrowRight className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Final Review and Submit Page */
                      <div>
                        <div className="pb-5 border-b border-slate-200">
                          <p className="text-xs font-medium text-[#0B6E79] uppercase tracking-wider">
                            Final Verification
                          </p>
                          <h2 className="font-heading text-xl sm:text-2xl font-bold text-[#0F1B2D] mt-1">
                            Review and Submit Evaluation
                          </h2>
                          <p className="text-sm text-slate-600 mt-1">
                            Verify each teacher&apos;s summary below. Once submitted, this evaluation cannot be reopened.
                          </p>
                        </div>

                        {!allQuestionsAnswered && (
                          <div
                            role="status"
                            className="mt-5 p-4 border border-amber-700 bg-amber-50 text-amber-950 text-sm flex items-start gap-2.5"
                          >
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-800" aria-hidden="true" />
                            <span>
                              You have answered <strong>{totalAnswered}</strong> of{' '}
                              <strong>{totalQuestions}</strong> questions. Complete every subject before submitting.
                            </span>
                          </div>
                        )}

                        {submitError && (
                          <div
                            role="alert"
                            className="mt-5 p-4 border border-red-700 bg-red-50 text-red-900 text-sm flex items-start gap-2.5"
                          >
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>{submitError}</span>
                          </div>
                        )}

                        <div className="mt-5 divide-y divide-slate-200 border border-slate-200">
                          {subjects.map((sub, idx) => {
                            const answeredCount = getSubjectAnsweredCount(sub.assignmentId);
                            const complete = answeredCount === questions.length;
                            const avg = getSubjectAverage(sub.assignmentId);
                            const commentText = comments[sub.assignmentId]?.trim();

                            return (
                              <div
                                key={sub.assignmentId}
                                className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-heading text-base font-semibold text-[#0F1B2D]">
                                      {sub.teacherName}
                                    </h3>
                                    <span
                                      className={`px-2 py-0.5 text-xs font-semibold tabular-nums border ${
                                        complete
                                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                                          : 'border-amber-700 bg-amber-50 text-amber-900'
                                      }`}
                                    >
                                      {answeredCount}/{questions.length} answered
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-600 mt-0.5">
                                    {sub.subjectCode} · {sub.subjectName}
                                  </p>
                                  {commentText && (
                                    <p className="text-xs text-slate-700 mt-2 bg-[#EDF1F5] border border-slate-200 px-3 py-2">
                                      Comment: &ldquo;{commentText}&rdquo;
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                                  <div className="text-left sm:text-right">
                                    <span className="text-xs text-slate-500 block">Average</span>
                                    <span className="font-heading text-lg font-bold text-[#0F1B2D] tabular-nums">
                                      {avg !== null ? `${avg.toFixed(2)} / 5` : '—'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveIndex(idx);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="min-h-[44px] px-3.5 py-2 border border-slate-400 bg-white hover:bg-slate-50 text-[#0F1B2D] text-sm font-medium inline-flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Edit3 className="w-4 h-4" aria-hidden="true" />
                                    <span>Edit</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-6 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setActiveIndex(subjects.length - 1)}
                            className="min-h-[44px] px-4 py-2.5 border border-slate-400 bg-white text-[#0F1B2D] text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                          >
                            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                            <span>Back to last subject</span>
                          </button>

                          <button
                            type="button"
                            disabled={!allQuestionsAnswered || submitting}
                            onClick={handleFinalSubmit}
                            className="min-h-[48px] px-6 py-3 bg-[#0B6E79] hover:bg-[#08545D] disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                          >
                            {allQuestionsAnswered ? (
                              <Check className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Send className="w-4 h-4" aria-hidden="true" />
                            )}
                            <span>
                              {submitting ? 'Submitting evaluation...' : 'Submit Final Evaluation'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
