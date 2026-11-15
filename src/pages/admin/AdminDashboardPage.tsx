import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../../services/api';
import { EvaluationForm } from '../../types';
import { ErrorState, FeedbackStateBadge, LoadingState } from '../../components/StateBlocks';

export function AdminDashboardPage() {
  const [overview, setOverview] = useState<{
    totalClasses: number;
    totalTeachers: number;
    totalStudents: number;
    openFormsCount: number;
    overallResponseRate: number;
    recentForms: EvaluationForm[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminOverview();
      setOverview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#0F1B2D]">
            Administration Dashboard
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Monitor active evaluation cycles, student participation rates, and departmental setup.
          </p>
        </div>
      </div>

      {loading && <LoadingState label="Loading evaluation overview..." rows={4} />}

      {!loading && error && (
        <ErrorState title="Dashboard unavailable" message={error} onRetry={loadOverview} />
      )}

      {!loading && !error && overview && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-300 p-5">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">Open Forms</p>
              <p className="font-heading text-3xl font-bold text-[#0B6E79] tabular-nums mt-2">
                {overview.openFormsCount}
              </p>
              <p className="text-xs text-slate-500 mt-1">Active across classes</p>
            </div>

            <div className="bg-white border border-slate-300 p-5">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">Overall Response Rate</p>
              <p className="font-heading text-3xl font-bold text-[#0F1B2D] tabular-nums mt-2">
                {overview.overallResponseRate}%
              </p>
              <p className="text-xs text-slate-500 mt-1">Eligible students submitted</p>
            </div>

            <div className="bg-white border border-slate-300 p-5">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">Active Faculty</p>
              <p className="font-heading text-3xl font-bold text-[#0F1B2D] tabular-nums mt-2">
                {overview.totalTeachers}
              </p>
              <p className="text-xs text-slate-500 mt-1">Across {overview.totalClasses} classes</p>
            </div>

            <div className="bg-white border border-slate-300 p-5">
              <p className="text-xs font-medium text-slate-600 uppercase tracking-wider">Enrolled Roster</p>
              <p className="font-heading text-3xl font-bold text-[#0F1B2D] tabular-nums mt-2">
                {overview.totalStudents}
              </p>
              <p className="text-xs text-slate-500 mt-1">Sample student accounts loaded</p>
            </div>
          </div>

          {/* Active Evaluation Forms with Live Response-Rate Bars */}
          <section aria-labelledby="recent-forms-heading" className="bg-white border border-slate-300">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h2 id="recent-forms-heading" className="font-heading text-lg font-semibold text-[#0F1B2D]">
                Evaluation Forms &amp; Response Progress
              </h2>
              <Link
                to="/admin/forms"
                className="min-h-[44px] px-4 py-2 bg-[#0B6E79] hover:bg-[#08545D] text-white text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap"
              >
                <span>Manage Forms</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="divide-y divide-slate-200">
              {overview.recentForms.map((form) => {
                const pct =
                  form.eligibleCount > 0
                    ? Math.min(100, Math.round((form.submittedCount / form.eligibleCount) * 1000) / 10)
                    : 0;
                return (
                  <div
                    key={form.id}
                    className="p-5 sm:px-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h3 className="font-heading text-base font-semibold text-[#0F1B2D]">
                          {form.title}
                        </h3>
                        <FeedbackStateBadge state={form.status} />
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 mt-1">
                        {form.className} · {form.semester} · Min attendance {form.minAttendance}% · Window{' '}
                        <span className="tabular-nums">{form.openDate}</span> to{' '}
                        <span className="tabular-nums">{form.closeDate}</span>
                      </p>
                    </div>

                    <div className="w-full lg:w-72 shrink-0">
                      <div className="flex justify-between text-xs font-medium text-[#0F1B2D] tabular-nums mb-1.5">
                        <span>Response Rate</span>
                        <span>
                          {form.submittedCount} / {form.eligibleCount} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-full bg-[#EDF1F5] border border-slate-300">
                        <div className="h-full bg-[#0B6E79]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Quick Workflows */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              to="/admin/students"
              className="bg-white border border-slate-300 hover:border-[#0B6E79] p-5 flex items-center justify-between gap-3 transition-colors"
            >
              <div>
                <h3 className="font-heading text-base font-semibold text-[#0F1B2D]">
                  Import Attendance Excel
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Upload .xlsx/.csv with row preview and validation report
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-[#0B6E79] shrink-0" aria-hidden="true" />
            </Link>

            <Link
              to="/admin/assignments"
              className="bg-white border border-slate-300 hover:border-[#0B6E79] p-5 flex items-center justify-between gap-3 transition-colors"
            >
              <div>
                <h3 className="font-heading text-base font-semibold text-[#0F1B2D]">
                  Subject-Teacher Mapping
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Assign faculty to class subjects per semester
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-[#0B6E79] shrink-0" aria-hidden="true" />
            </Link>

            <Link
              to="/admin/analysis"
              className="bg-white border border-slate-300 hover:border-[#0B6E79] p-5 flex items-center justify-between gap-3 transition-colors"
            >
              <div>
                <h3 className="font-heading text-base font-semibold text-[#0F1B2D]">
                  View Evaluation Analysis
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Rankings, distributions, and Excel/PDF reports
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-[#0B6E79] shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
