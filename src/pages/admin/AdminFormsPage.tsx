import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../../services/api';
import { DEFAULT_QUESTIONS } from '../../data/mockDb';
import {
  AcademicClass,
  EvaluationForm,
  EvaluationQuestion,
  FormStatus,
  QUESTION_CATEGORIES,
} from '../../types';
import {
  EmptyState,
  ErrorState,
  FeedbackStateBadge,
  LoadingState,
} from '../../components/StateBlocks';

const SEMESTERS = [
  'Semester I',
  'Semester II',
  'Semester III',
  'Semester IV',
  'Semester V',
  'Semester VI',
];

export function AdminFormsPage() {
  const [forms, setForms] = useState<EvaluationForm[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Builder modal/panel state
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingFormId, setEditingFormId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState('');
  const [semester, setSemester] = useState('Semester III');
  const [academicYear, setAcademicYear] = useState('2026-27');
  const [minAttendance, setMinAttendance] = useState(75);
  const [openDate, setOpenDate] = useState('2026-11-14');
  const [closeDate, setCloseDate] = useState('2026-11-30');
  const [status, setStatus] = useState<FormStatus>('draft');
  const [questions, setQuestions] = useState<EvaluationQuestion[]>(DEFAULT_QUESTIONS);

  // AI generation & drag state
  const [generatingAI, setGeneratingAI] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [srAnnouncement, setSrAnnouncement] = useState('');

  const loadForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getForms();
      setForms(res.forms);
      setClasses(res.classes);
      setClassId((prev) => prev || res.classes[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load evaluation forms.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  function openNewBuilder() {
    setEditingFormId(null);
    setTitle('');
    setClassId(classes[0]?.id ?? '');
    setSemester('Semester III');
    setAcademicYear('2026-27');
    setMinAttendance(75);
    setOpenDate('2026-11-14');
    setCloseDate('2026-11-30');
    setStatus('draft');
    setQuestions(DEFAULT_QUESTIONS.map((q) => ({ ...q })));
    setAiMessage(null);
    setBuilderError(null);
    setShowBuilder(true);
  }

  function openEditBuilder(form: EvaluationForm) {
    setEditingFormId(form.id);
    setTitle(form.title);
    setClassId(form.classId);
    setSemester(form.semester);
    setAcademicYear(form.academicYear);
    setMinAttendance(form.minAttendance);
    setOpenDate(form.openDate);
    setCloseDate(form.closeDate);
    setStatus(form.status);
    setQuestions(form.questions.map((q) => ({ ...q })));
    setAiMessage(null);
    setBuilderError(null);
    setShowBuilder(true);
  }

  async function handleGenerateWithAI() {
    const selectedClass = classes.find((c) => c.id === classId);
    setGeneratingAI(true);
    setBuilderError(null);
    setAiMessage(null);
    try {
      const result = await api.generateQuestionsWithAI({
        className: selectedClass?.name ?? 'College Class',
        course: selectedClass?.course ?? 'Undergraduate Course',
        semester,
        academicYear,
      });
      setQuestions(result.questions);
      setAiMessage(
        result.source !== 'mock'
          ? `Generated ${result.questions.length} tailored questions with AI.`
          : `Generated ${result.questions.length} category-grouped questions.`
      );
      setSrAnnouncement(`Generated ${result.questions.length} evaluation questions.`);
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'AI question generation failed.');
    } finally {
      setGeneratingAI(false);
    }
  }

  function updateQuestion(id: string, patch: Partial<EvaluationQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function addManualQuestion(category: string) {
    const newQ: EvaluationQuestion = {
      id: `q-custom-${Date.now()}`,
      category,
      text: 'New evaluation criterion...',
      order: questions.length + 1,
    };
    setQuestions((prev) => [...prev, newQ]);
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  function reorderByIds(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setQuestions((prev) => {
      const srcIdx = prev.findIndex((q) => q.id === sourceId);
      const tgtIdx = prev.findIndex((q) => q.id === targetId);
      if (srcIdx === -1 || tgtIdx === -1) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(srcIdx, 1);
      // Adopt target's category if dropped onto a question in another category
      const targetCategory = prev[tgtIdx].category;
      copy.splice(tgtIdx, 0, { ...moved, category: targetCategory });
      return copy.map((q, idx) => ({ ...q, order: idx + 1 }));
    });
    setSrAnnouncement('Question order updated.');
  }

  function moveQuestionStep(id: string, direction: -1 | 1) {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      const nextIdx = idx + direction;
      if (idx === -1 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, moved);
      return copy.map((q, i) => ({ ...q, order: i + 1 }));
    });
    setSrAnnouncement(`Moved question ${direction === -1 ? 'up' : 'down'}.`);
  }

  async function handleSaveForm(e: React.FormEvent) {
    e.preventDefault();
    setBuilderError(null);
    if (!classId) {
      setBuilderError('Select a class.');
      return;
    }
    if (openDate > closeDate) {
      setBuilderError('Close date must be on or after the open date.');
      return;
    }
    if (questions.length === 0) {
      setBuilderError('Add at least one evaluation question.');
      return;
    }

    setSaving(true);
    try {
      await api.createOrUpdateForm({
        id: editingFormId ?? undefined,
        title,
        classId,
        semester,
        academicYear,
        minAttendance: Number(minAttendance),
        openDate,
        closeDate,
        status,
        questions,
      });
      setShowBuilder(false);
      await loadForms();
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Unable to save form.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(formId: string, nextStatus: FormStatus) {
    try {
      await api.updateFormStatus(formId, nextStatus);
      await loadForms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update form status.');
    }
  }

  // Group questions by category while preserving order
  const categoriesInUse = Array.from(
    new Set([...QUESTION_CATEGORIES, ...questions.map((q) => q.category)])
  );

  return (
    <div className="space-y-6">
      <div className="sr-only" aria-live="polite">
        {srAnnouncement}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#0F1B2D]">
            Evaluation Forms
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Create semester evaluation forms, configure attendance thresholds, and track live response rates.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewBuilder}
          className="min-h-[44px] px-4 py-2.5 bg-[#0B6E79] hover:bg-[#08545D] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Create Evaluation Form</span>
        </button>
      </div>

      {/* Form Builder */}
      {showBuilder && (
        <section
          aria-labelledby="form-builder-heading"
          className="bg-white border border-slate-300 p-5 sm:p-7 space-y-6"
        >
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <h2 id="form-builder-heading" className="font-heading text-xl font-bold text-[#0F1B2D]">
              {editingFormId ? 'Edit Evaluation Form' : 'New Evaluation Form'}
            </h2>
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="min-h-[44px] px-3.5 border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Close
            </button>
          </div>

          {builderError && (
            <div role="alert" className="p-4 border border-red-700 bg-red-50 text-red-900 text-sm">
              {builderError}
            </div>
          )}

          <form onSubmit={handleSaveForm} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="form-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Form Title (leave blank to auto-generate)
                </label>
                <input
                  id="form-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="End-Semester Faculty Feedback · SY B.Sc. CS (Sem III)"
                  className="w-full min-h-[44px] px-3.5 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
                />
              </div>

              <div>
                <label htmlFor="form-class" className="block text-xs font-medium text-slate-700 mb-1">
                  Class
                </label>
                <select
                  id="form-class"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="form-sem" className="block text-xs font-medium text-slate-700 mb-1">
                  Semester
                </label>
                <select
                  id="form-sem"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
                >
                  {SEMESTERS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="form-min-att" className="block text-xs font-medium text-slate-700 mb-1">
                  Minimum Attendance (%)
                </label>
                <input
                  id="form-min-att"
                  type="number"
                  min={0}
                  max={100}
                  value={minAttendance}
                  onChange={(e) => setMinAttendance(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm tabular-nums text-[#0F1B2D]"
                />
              </div>

              <div>
                <label htmlFor="form-open-date" className="block text-xs font-medium text-slate-700 mb-1">
                  Open Date
                </label>
                <input
                  id="form-open-date"
                  type="date"
                  value={openDate}
                  onChange={(e) => setOpenDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm tabular-nums text-[#0F1B2D]"
                />
              </div>

              <div>
                <label htmlFor="form-close-date" className="block text-xs font-medium text-slate-700 mb-1">
                  Close Date
                </label>
                <input
                  id="form-close-date"
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm tabular-nums text-[#0F1B2D]"
                />
              </div>

              <div>
                <label htmlFor="form-status" className="block text-xs font-medium text-slate-700 mb-1">
                  Initial Status
                </label>
                <select
                  id="form-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as FormStatus)}
                  className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
                >
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            {/* AI Question Generator & Drag-to-Reorder Category List */}
            <div className="border-t border-slate-200 pt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-base font-bold text-[#0F1B2D]">
                    Evaluation Questions ({questions.length})
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Drag handles or use the arrow buttons to reorder questions. Questions are grouped by category.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={generatingAI}
                  onClick={handleGenerateWithAI}
                  className="min-h-[44px] px-4 py-2 bg-[#0F1B2D] hover:bg-[#1A2B45] disabled:opacity-60 text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-[#7dd3dc]" aria-hidden="true" />
                  <span>{generatingAI ? 'Generating questions...' : 'Generate questions with AI'}</span>
                </button>
              </div>

              {aiMessage && (
                <div
                  role="status"
                  className="p-3 border border-[#0B6E79] bg-[#E6F2F3] text-[#08545D] text-xs sm:text-sm font-medium"
                >
                  {aiMessage}
                </div>
              )}

              <div className="space-y-5">
                {categoriesInUse.map((cat) => {
                  const catQuestions = questions.filter((q) => q.category === cat);
                  return (
                    <div key={cat} className="border border-slate-300 bg-[#EDF1F5]">
                      <div className="px-4 py-2.5 bg-slate-200/70 border-b border-slate-300 flex items-center justify-between gap-3">
                        <h4 className="font-heading text-sm font-semibold text-[#0F1B2D]">
                          {cat} ({catQuestions.length})
                        </h4>
                        <button
                          type="button"
                          onClick={() => addManualQuestion(cat)}
                          className="min-h-[44px] px-3 text-xs font-medium text-[#0B6E79] hover:text-[#08545D] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Add Question</span>
                        </button>
                      </div>

                      {catQuestions.length === 0 ? (
                        <p className="p-4 text-xs text-slate-600">
                          No questions in this category. Drag a question here or click Add Question.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-200 bg-white">
                          {catQuestions.map((q) => {
                            const globalIdx = questions.findIndex((item) => item.id === q.id);
                            const isDragTarget = dragOverId === q.id && draggedId !== q.id;
                            return (
                              <li
                                key={q.id}
                                draggable
                                onDragStart={() => setDraggedId(q.id)}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setDragOverId(q.id);
                                }}
                                onDragLeave={() => setDragOverId(null)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedId) reorderByIds(draggedId, q.id);
                                  setDraggedId(null);
                                  setDragOverId(null);
                                }}
                                onDragEnd={() => {
                                  setDraggedId(null);
                                  setDragOverId(null);
                                }}
                                className={`p-3 flex flex-col sm:flex-row sm:items-center gap-2.5 transition-colors ${
                                  isDragTarget ? 'bg-[#E6F2F3] border-t-2 border-[#0B6E79]' : 'bg-white'
                                }`}
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span
                                    aria-hidden="true"
                                    title="Drag to reorder"
                                    className="min-w-[32px] min-h-[44px] flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing"
                                  >
                                    <GripVertical className="w-4 h-4" />
                                  </span>
                                  <input
                                    type="text"
                                    aria-label={`Question ${globalIdx + 1} text`}
                                    value={q.text}
                                    onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                                    className="flex-1 min-h-[44px] px-3 border border-slate-300 text-sm text-[#0F1B2D] focus:border-[#0B6E79]"
                                  />
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 justify-end">
                                  <select
                                    aria-label={`Category for question ${globalIdx + 1}`}
                                    value={q.category}
                                    onChange={(e) => updateQuestion(q.id, { category: e.target.value })}
                                    className="min-h-[44px] px-2 border border-slate-300 text-xs bg-white text-[#0F1B2D]"
                                  >
                                    {QUESTION_CATEGORIES.map((cOpt) => (
                                      <option key={cOpt} value={cOpt}>
                                        {cOpt}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={globalIdx === 0}
                                    onClick={() => moveQuestionStep(q.id, -1)}
                                    aria-label="Move question up"
                                    className="min-w-[44px] min-h-[44px] border border-slate-300 hover:bg-slate-50 disabled:opacity-35 flex items-center justify-center cursor-pointer"
                                  >
                                    <ArrowUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={globalIdx === questions.length - 1}
                                    onClick={() => moveQuestionStep(q.id, 1)}
                                    aria-label="Move question down"
                                    className="min-w-[44px] min-h-[44px] border border-slate-300 hover:bg-slate-50 disabled:opacity-35 flex items-center justify-center cursor-pointer"
                                  >
                                    <ArrowDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeQuestion(q.id)}
                                    aria-label="Delete question"
                                    className="min-w-[44px] min-h-[44px] border border-slate-300 text-slate-500 hover:text-red-700 hover:bg-red-50 flex items-center justify-center cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBuilder(false)}
                className="min-h-[44px] px-4 py-2 border border-slate-400 bg-white text-sm font-medium text-[#0F1B2D] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-6 py-2.5 bg-[#0B6E79] hover:bg-[#08545D] disabled:opacity-60 text-white text-sm font-medium cursor-pointer"
              >
                {saving ? 'Saving form...' : editingFormId ? 'Update Form' : 'Save Evaluation Form'}
              </button>
            </div>
          </form>
        </section>
      )}

      {loading && <LoadingState label="Loading evaluation forms..." rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={loadForms} />}

      {!loading && !error && forms.length === 0 && (
        <EmptyState
          title="No Evaluation Forms"
          description="Create an evaluation form for a class and semester to start collecting student feedback."
          actionLabel="Create Evaluation Form"
          onAction={openNewBuilder}
        />
      )}

      {!loading && !error && forms.length > 0 && (
        <div className="space-y-4">
          {forms.map((form) => {
            const pct =
              form.eligibleCount > 0
                ? Math.min(100, Math.round((form.submittedCount / form.eligibleCount) * 1000) / 10)
                : 0;
            return (
              <article
                key={form.id}
                className="bg-white border border-slate-300 p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="font-heading text-lg font-bold text-[#0F1B2D]">
                        {form.title}
                      </h2>
                      <FeedbackStateBadge state={form.status} />
                    </div>
                    <p className="text-sm text-slate-600 mt-1">
                      {form.className} · {form.semester} · Min Attendance:{' '}
                      <strong className="tabular-nums text-[#0F1B2D]">{form.minAttendance}%</strong> ·{' '}
                      <span className="tabular-nums">
                        {form.openDate} to {form.closeDate}
                      </span>{' '}
                      · {form.questions.length} questions
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditBuilder(form)}
                      className="min-h-[44px] px-3.5 py-2 border border-slate-400 bg-white hover:bg-slate-50 text-xs sm:text-sm font-medium text-[#0F1B2D] cursor-pointer"
                    >
                      Edit Form
                    </button>
                    {form.status !== 'open' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(form.id, 'open')}
                        className="min-h-[44px] px-3.5 py-2 bg-[#0B6E79] hover:bg-[#08545D] text-white text-xs sm:text-sm font-medium cursor-pointer"
                      >
                        Set Open
                      </button>
                    )}
                    {form.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(form.id, 'closed')}
                        className="min-h-[44px] px-3.5 py-2 bg-[#0F1B2D] hover:bg-[#1A2B45] text-white text-xs sm:text-sm font-medium cursor-pointer"
                      >
                        Close Form
                      </button>
                    )}
                  </div>
                </div>

                {/* Live Response-Rate Bar */}
                <div className="pt-2 border-t border-slate-200">
                  <div className="flex justify-between text-xs font-medium text-[#0F1B2D] tabular-nums mb-1.5">
                    <span>Live Response Rate</span>
                    <span>
                      {form.submittedCount} of {form.eligibleCount} eligible students ({pct}%)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${form.title} response rate ${pct}%`}
                    className="h-3 w-full bg-[#EDF1F5] border border-slate-300"
                  >
                    <div className="h-full bg-[#0B6E79] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
