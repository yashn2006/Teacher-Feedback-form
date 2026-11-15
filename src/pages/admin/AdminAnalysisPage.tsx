import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Download,
  EyeOff,
  FileSpreadsheet,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { api } from '../../services/api';
import {
  AdminUser,
  AnalysisReportPayload,
  CLASS_LEVELS,
  ClassLevel,
} from '../../types';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateBlocks';

export function AdminAnalysisPage() {
  const { adminUser } = useOutletContext<{ adminUser: Omit<AdminUser, 'password'> }>();
  const [filterOptions, setFilterOptions] = useState<{
    academicYears: string[];
    courses: string[];
    semesters: string[];
    levels: ClassLevel[];
  }>({
    academicYears: [],
    courses: [],
    semesters: ['Semester I', 'Semester II', 'Semester III', 'Semester IV', 'Semester V', 'Semester VI'],
    levels: ['FY', 'SY', 'TY', 'PG-I', 'PG-II'],
  });

  const isHod = adminUser.role === 'hod';
  const [activeTab, setActiveTab] = useState<'class' | 'overall'>('overall');
  const [selectedLevel, setSelectedLevel] = useState<ClassLevel>('SY');
  const [academicYear, setAcademicYear] = useState<string>('2026-27');
  const [semester, setSemester] = useState<string>('ALL');
  const [course, setCourse] = useState<string>(
    isHod && adminUser.course ? adminUser.course : 'ALL'
  );

  const [report, setReport] = useState<AnalysisReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnalysisReport(
        {
          academicYear,
          level: activeTab === 'class' ? selectedLevel : 'ALL',
          semester,
          course: isHod && adminUser.course ? adminUser.course : course,
        },
        adminUser
      );
      setReport(data);
      setSelectedTeacherId(data.teacherRankings[0]?.teacherId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate analysis report.');
    } finally {
      setLoading(false);
    }
  }, [academicYear, activeTab, selectedLevel, semester, course, adminUser, isHod]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Drop-down values come from the server (an HOD only receives their own course).
  useEffect(() => {
    api
      .getFilterOptions()
      .then((options) => {
        setFilterOptions(options);
        setAcademicYear((current) =>
          options.academicYears.length > 0 && !options.academicYears.includes(current)
            ? options.academicYears[0]
            : current
        );
      })
      .catch(() => undefined);
  }, []);

  function handleExportExcel() {
    if (!report) return;
    const wb = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet([
      {
        AcademicYear: academicYear,
        View: activeTab === 'class' ? `Class (${selectedLevel})` : 'Overall',
        Course: isHod && adminUser.course ? adminUser.course : course,
        Semester: semester,
        TotalResponses: report.summary.totalResponses,
        TotalEligible: report.summary.totalEligible,
        ResponseRatePercent: report.summary.responseRate,
        OverallAverageOutOf5: report.summary.overallAverage,
        TeachersShown: report.summary.visibleTeachersCount,
        TeachersHiddenUnder5Responses: report.summary.hiddenTeachersCount,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    const rankingsSheet = XLSX.utils.json_to_sheet(
      report.teacherRankings.map((t, idx) => ({
        Rank: idx + 1,
        TeacherName: t.teacherName,
        Department: t.department,
        SubjectCode: t.subjectCode,
        SubjectName: t.subjectName,
        Class: t.className,
        Semester: t.semester,
        Responses: t.responseCount,
        AverageScore: t.averageScore,
      }))
    );
    XLSX.utils.book_append_sheet(wb, rankingsSheet, 'Teacher Rankings');

    const categoriesSheet = XLSX.utils.json_to_sheet(
      report.categoryAverages.map((c) => ({
        Category: c.category,
        AverageOutOf5: c.average,
      }))
    );
    XLSX.utils.book_append_sheet(wb, categoriesSheet, 'Category Averages');

    const distSheet = XLSX.utils.json_to_sheet(
      report.ratingDistribution.map((d) => ({
        Rating: d.rating,
        Label: d.label,
        Count: d.count,
        Percent: d.percent,
      }))
    );
    XLSX.utils.book_append_sheet(wb, distSheet, 'Rating Distribution');

    XLSX.writeFile(wb, `SIES_Evaluation_Analysis_${academicYear}.xlsx`);
  }

  function handleExportPDF() {
    if (!report) return;
    const doc = new jsPDF();
    const effectiveCourse = isHod && adminUser.course ? adminUser.course : course;

    doc.setFillColor(15, 27, 45);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15);
    doc.text('SIES Teacher Evaluation System — Analysis Report', 14, 13);
    doc.setFontSize(9);
    doc.text(
      `Year: ${academicYear}  |  View: ${
        activeTab === 'class' ? `Class ${selectedLevel}` : 'Overall'
      }  |  Course: ${effectiveCourse}  |  Semester: ${semester}`,
      14,
      21
    );

    doc.setTextColor(15, 27, 45);
    doc.setFontSize(10);
    doc.text(
      `Overall Average: ${report.summary.overallAverage.toFixed(2)} / 5.00   |   Response Rate: ${
        report.summary.responseRate
      }% (${report.summary.totalResponses}/${report.summary.totalEligible})   |   Note: Teachers with <5 responses hidden`,
      14,
      37
    );

    autoTable(doc, {
      startY: 43,
      head: [['Rank', 'Teacher', 'Subject', 'Class', 'Responses', 'Avg (/5)']],
      body: report.teacherRankings.map((t, idx) => [
        String(idx + 1),
        t.teacherName,
        `${t.subjectCode} ${t.subjectName}`,
        t.className,
        String(t.responseCount),
        t.averageScore.toFixed(2),
      ]),
      headStyles: { fillColor: [11, 110, 121] },
      styles: { fontSize: 8.5 },
    });

    const afterRankingsY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 120;
    autoTable(doc, {
      startY: afterRankingsY + 10,
      head: [['Evaluation Category', 'Average Score (/5)']],
      body: report.categoryAverages.map((c) => [c.category, c.average.toFixed(2)]),
      headStyles: { fillColor: [15, 27, 45] },
      styles: { fontSize: 9 },
    });

    doc.save(`SIES_Evaluation_Analysis_${academicYear}.pdf`);
  }

  const selectedTeacherComments = useMemo(() => {
    if (!report || !selectedTeacherId) return null;
    return report.teacherRankings.find((t) => t.teacherId === selectedTeacherId) ?? null;
  }, [report, selectedTeacherId]);

  const maxDistCount = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, ...report.ratingDistribution.map((d) => d.count));
  }, [report]);

  return (
    <div className="space-y-6">
      {/* Header + Export Controls */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#0F1B2D]">
            Evaluation Analysis
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {isHod
              ? `Department-scoped faculty performance analytics for ${adminUser.course}.`
              : 'Institution-wide teacher performance, category breakdowns, and participation metrics.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={!report || report.teacherRankings.length === 0}
            onClick={handleExportExcel}
            className="min-h-[44px] px-4 py-2 border border-slate-400 bg-white hover:bg-slate-50 disabled:opacity-50 text-sm font-medium text-[#0F1B2D] inline-flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#0B6E79]" aria-hidden="true" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            disabled={!report || report.teacherRankings.length === 0}
            onClick={handleExportPDF}
            className="min-h-[44px] px-4 py-2 bg-[#0B6E79] hover:bg-[#08545D] disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer"
          >
            <FileText className="w-4 h-4" aria-hidden="true" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* Tabs: Overall vs Class (FY, SY, TY, PG-I, PG-II) + Filters */}
      <section aria-label="Analysis scope and filters" className="bg-white border border-slate-300 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div role="tablist" aria-label="Analysis view level" className="inline-flex border border-slate-300 bg-[#EDF1F5] p-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'overall'}
              onClick={() => setActiveTab('overall')}
              className={`min-h-[44px] px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'overall'
                  ? 'bg-[#0F1B2D] text-white'
                  : 'text-[#0F1B2D] hover:bg-white'
              }`}
            >
              Overall Tab
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'class'}
              onClick={() => setActiveTab('class')}
              className={`min-h-[44px] px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                activeTab === 'class'
                  ? 'bg-[#0F1B2D] text-white'
                  : 'text-[#0F1B2D] hover:bg-white'
              }`}
            >
              Class Tab (FY–PG-II)
            </button>
          </div>

          {activeTab === 'class' && (
            <div role="group" aria-label="Select class level" className="flex flex-wrap gap-1.5">
              {CLASS_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSelectedLevel(lvl)}
                  aria-pressed={selectedLevel === lvl}
                  className={`min-h-[44px] min-w-[52px] px-3 text-sm font-semibold border transition-colors cursor-pointer ${
                    selectedLevel === lvl
                      ? 'bg-[#0B6E79] border-[#0B6E79] text-white'
                      : 'bg-white border-slate-300 text-[#0F1B2D] hover:bg-slate-50'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="ana-year" className="block text-xs font-medium text-slate-700 mb-1">
              Academic Year
            </label>
            <select
              id="ana-year"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
            >
              {filterOptions.academicYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ana-sem" className="block text-xs font-medium text-slate-700 mb-1">
              Semester
            </label>
            <select
              id="ana-sem"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
            >
              <option value="ALL">All Semesters</option>
              {filterOptions.semesters.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="ana-course" className="block text-xs font-medium text-slate-700 mb-1">
              Course {isHod ? '(Locked to HOD Scope)' : ''}
            </label>
            <select
              id="ana-course"
              disabled={isHod}
              value={isHod && adminUser.course ? adminUser.course : course}
              onChange={(e) => setCourse(e.target.value)}
              className="w-full min-h-[44px] px-3 bg-white border border-slate-400 text-sm text-[#0F1B2D] disabled:bg-[#EDF1F5] disabled:text-slate-700"
            >
              {!isHod && <option value="ALL">All Courses</option>}
              {filterOptions.courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loading && <LoadingState label="Computing faculty analytics..." rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={loadReport} />}

      {!loading && !error && report && (
        <>
          {/* Privacy Threshold Notice (< 5 responses hidden) */}
          {report.summary.hiddenTeachersCount > 0 && (
            <div
              role="note"
              className="bg-white border border-slate-400 p-4 flex items-start gap-3 text-sm text-[#0F1B2D]"
            >
              <EyeOff className="w-5 h-5 text-[#0B6E79] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Anonymity Rule Active: {report.summary.hiddenTeachersCount} teacher evaluation
                  {report.summary.hiddenTeachersCount === 1 ? '' : 's'} with fewer than 5 responses hidden
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  To protect student confidentiality, faculty with fewer than 5 submitted evaluations are
                  excluded from rankings, averages, and exports ({report.hiddenTeachersNotice
                    .map((h) => `${h.subjectName}: ${h.responseCount} responses`)
                    .join(' · ')}).
                </p>
              </div>
            </div>
          )}

          {report.teacherRankings.length === 0 ? (
            <EmptyState
              title="No Publishable Evaluation Data"
              description="No teachers in the selected filters currently meet the minimum threshold of 5 responses."
              actionLabel="Reset Filters"
              onAction={() => {
                setActiveTab('overall');
                setSemester('ALL');
                if (!isHod) setCourse('ALL');
              }}
            />
          ) : (
            <div className="space-y-6">
              {/* KPI Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-300 p-5">
                  <p className="text-xs text-slate-600 uppercase font-medium">Overall Mean Score</p>
                  <p className="font-heading text-3xl font-bold text-[#0B6E79] tabular-nums mt-1.5">
                    {report.summary.overallAverage.toFixed(2)}{' '}
                    <span className="text-base font-normal text-slate-500">/ 5.00</span>
                  </p>
                </div>

                <div className="bg-white border border-slate-300 p-5">
                  <p className="text-xs text-slate-600 uppercase font-medium">Response Rate</p>
                  <p className="font-heading text-3xl font-bold text-[#0F1B2D] tabular-nums mt-1.5">
                    {report.summary.responseRate}%
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                    {report.summary.totalResponses} of {report.summary.totalEligible} eligible students
                  </p>
                </div>

                <div className="bg-white border border-slate-300 p-5">
                  <p className="text-xs text-slate-600 uppercase font-medium">Published Teachers</p>
                  <p className="font-heading text-3xl font-bold text-[#0F1B2D] tabular-nums mt-1.5">
                    {report.summary.visibleTeachersCount}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Meeting ≥ 5 response threshold</p>
                </div>

                <div className="bg-white border border-slate-300 p-5">
                  <p className="text-xs text-slate-600 uppercase font-medium">Hidden (&lt; 5 Resp.)</p>
                  <p className="font-heading text-3xl font-bold text-slate-700 tabular-nums mt-1.5">
                    {report.summary.hiddenTeachersCount}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Protected for anonymity</p>
                </div>
              </div>

              {/* Charts Grid: 1. Teacher Ranking Bar Chart & 2. Category Averages */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Chart 1: Teacher Ranking Bar Chart */}
                <section
                  aria-labelledby="chart-ranking-heading"
                  className="xl:col-span-7 bg-white border border-slate-300 p-5 sm:p-6"
                >
                  <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
                    <div>
                      <h2 id="chart-ranking-heading" className="font-heading text-lg font-bold text-[#0F1B2D]">
                        Teacher Ranking Bar Chart
                      </h2>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Mean score out of 5.00 (teachers with ≥ 5 responses only)
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3.5" role="list" aria-label="Teacher ranking scores">
                    {report.teacherRankings.map((item, idx) => {
                      const barWidth = Math.max(4, (item.averageScore / 5) * 100);
                      const isSelected = selectedTeacherId === item.teacherId;
                      return (
                        <button
                          key={`${item.teacherId}-${item.subjectCode}-${item.className}`}
                          type="button"
                          onClick={() => setSelectedTeacherId(item.teacherId)}
                          className={`w-full text-left p-2.5 border transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-[#0B6E79] bg-[#E6F2F3]/60'
                              : 'border-transparent hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm mb-1.5">
                            <span className="font-semibold text-[#0F1B2D]">
                              <span className="font-mono text-xs text-slate-500 mr-2">#{idx + 1}</span>
                              {item.teacherName}
                            </span>
                            <span className="font-mono text-sm font-bold text-[#0B6E79] tabular-nums">
                              {item.averageScore.toFixed(2)} / 5.00
                            </span>
                          </div>
                          <div className="h-5 w-full bg-[#EDF1F5] border border-slate-300">
                            <div
                              className="h-full bg-[#0B6E79]"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600 mt-1">
                            <span>
                              {item.subjectCode} · {item.subjectName} ({item.className})
                            </span>
                            <span className="tabular-nums font-medium">n = {item.responseCount} responses</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Chart 2: Category Averages + Chart 3: 1-5 Distribution */}
                <div className="xl:col-span-5 space-y-6">
                  {/* Category Averages */}
                  <section
                    aria-labelledby="chart-cat-heading"
                    className="bg-white border border-slate-300 p-5 sm:p-6"
                  >
                    <h2 id="chart-cat-heading" className="font-heading text-lg font-bold text-[#0F1B2D]">
                      Category Averages
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5 pb-4 border-b border-slate-200">
                      Aggregated mean across evaluation dimensions
                    </p>
                    <div className="mt-4 space-y-4">
                      {report.categoryAverages.map((cat) => {
                        const pct = (cat.average / 5) * 100;
                        return (
                          <div key={cat.category}>
                            <div className="flex justify-between gap-2 text-xs sm:text-sm mb-1">
                              <span className="font-medium text-[#0F1B2D]">{cat.category}</span>
                              <span className="font-mono font-bold text-[#0F1B2D] tabular-nums shrink-0">
                                {cat.average.toFixed(2)}
                              </span>
                            </div>
                            <div className="h-3.5 w-full bg-[#EDF1F5] border border-slate-300">
                              <div className="h-full bg-[#0F1B2D]" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* 1-5 Rating Distribution */}
                  <section
                    aria-labelledby="chart-dist-heading"
                    className="bg-white border border-slate-300 p-5 sm:p-6"
                  >
                    <h2 id="chart-dist-heading" className="font-heading text-lg font-bold text-[#0F1B2D]">
                      1–5 Rating Distribution
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5 pb-4 border-b border-slate-200">
                      Share of all submitted item ratings
                    </p>
                    <div className="mt-4 space-y-3">
                      {report.ratingDistribution
                        .slice()
                        .reverse()
                        .map((d) => {
                          const w = Math.round((d.count / maxDistCount) * 100);
                          return (
                            <div key={d.rating} className="grid grid-cols-12 items-center gap-2 text-xs">
                              <span className="col-span-4 font-medium text-[#0F1B2D] truncate">
                                {d.rating} · {d.label}
                              </span>
                              <div className="col-span-5 h-4 bg-[#EDF1F5] border border-slate-300">
                                <div className="h-full bg-[#0B6E79]" style={{ width: `${w}%` }} />
                              </div>
                              <span className="col-span-3 text-right font-mono tabular-nums text-slate-700">
                                {d.percent}% ({d.count})
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </section>
                </div>
              </div>

              {/* Chart 4: Response Rate Breakdown + Teacher Comments Panel */}
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <section
                  aria-labelledby="chart-response-heading"
                  className="xl:col-span-7 bg-white border border-slate-300 p-5 sm:p-6"
                >
                  <h2 id="chart-response-heading" className="font-heading text-lg font-bold text-[#0F1B2D]">
                    Class Response Rate Breakdown
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 pb-4 border-b border-slate-200">
                    Submissions vs eligible students per active class form
                  </p>
                  <div className="mt-4 space-y-4">
                    {report.classResponseRates.map((cr) => (
                      <div key={`${cr.classId}-${cr.semester}`}>
                        <div className="flex flex-wrap justify-between gap-2 text-xs sm:text-sm mb-1.5">
                          <span className="font-medium text-[#0F1B2D]">
                            {cr.className} · {cr.semester}
                          </span>
                          <span className="font-mono tabular-nums text-slate-700">
                            {cr.submitted}/{cr.eligible} ({cr.rate}%)
                          </span>
                        </div>
                        <div className="h-3.5 w-full bg-[#EDF1F5] border border-slate-300">
                          <div className="h-full bg-[#0B6E79]" style={{ width: `${cr.rate}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Qualitative Comments for Selected Teacher */}
                <section
                  aria-labelledby="comments-heading"
                  className="xl:col-span-5 bg-white border border-slate-300 p-5 sm:p-6"
                >
                  <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
                    <div>
                      <h2 id="comments-heading" className="font-heading text-lg font-bold text-[#0F1B2D] flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-[#0B6E79]" aria-hidden="true" />
                        <span>Student Remarks</span>
                      </h2>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {selectedTeacherComments
                          ? `${selectedTeacherComments.teacherName} (${selectedTeacherComments.subjectCode})`
                          : 'Select a teacher in the ranking chart'}
                      </p>
                    </div>
                  </div>

                  {!selectedTeacherComments || selectedTeacherComments.comments.length === 0 ? (
                    <p className="text-sm text-slate-600 py-6">
                      No written student comments recorded for this faculty selection.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {selectedTeacherComments.comments.map((c, idx) => (
                        <li
                          key={idx}
                          className="p-3.5 bg-[#EDF1F5] border border-slate-200 text-sm text-[#0F1B2D]"
                        >
                          <p>&ldquo;{c.text}&rdquo;</p>
                          <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
                            Submitted {new Date(c.submittedAt).toLocaleDateString()}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
