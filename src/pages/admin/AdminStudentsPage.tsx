import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import { AcademicClass, StudentImportRow, StudentRecord } from '../../types';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateBlocks';

export function AdminStudentsPage() {
  const [students, setStudents] = useState<Array<Omit<StudentRecord, 'password'>>>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');

  // Excel upload preview & error report state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadFilename, setUploadFilename] = useState<string>('');
  const [previewRows, setPreviewRows] = useState<StudentImportRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStudents();
      setStudents(res.students);
      setClasses(res.classes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load student records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (classFilter !== 'ALL' && s.classId !== classFilter) return false;
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          s.rollNumber.toLowerCase().includes(q) ||
          s.className.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [students, search, classFilter]);

  function validateRawRows(rawRows: Array<Record<string, unknown>>): StudentImportRow[] {
    const classNames = new Set(classes.map((c) => c.name.toLowerCase()));
    const seenRolls = new Set<string>();

    return rawRows.map((raw, index) => {
      const rowNumber = index + 2; // Excel header is row 1
      const rollNumber = String(
        raw.rollNumber ?? raw['Roll Number'] ?? raw['roll_number'] ?? raw.RollNo ?? ''
      )
        .trim()
        .toUpperCase();
      const name = String(raw.name ?? raw['Student Name'] ?? raw.Name ?? '').trim();
      const className = String(raw.className ?? raw['Class Name'] ?? raw.Class ?? '').trim();
      const semester = String(raw.semester ?? raw.Semester ?? '').trim();
      const rawAtt = raw.attendancePercent ?? raw['Attendance %'] ?? raw.Attendance ?? raw.attendance;
      const attendancePercent = Number(rawAtt);

      const rowErrors: string[] = [];

      if (!rollNumber) {
        rowErrors.push('Missing roll number');
      } else if (seenRolls.has(rollNumber)) {
        rowErrors.push(`Duplicate roll number (${rollNumber}) in spreadsheet`);
      } else {
        seenRolls.add(rollNumber);
      }

      if (!name) rowErrors.push('Missing student name');
      if (!className) {
        rowErrors.push('Missing class name');
      } else if (!classNames.has(className.toLowerCase())) {
        rowErrors.push(`Unknown class "${className}"`);
      }

      if (!semester || !semester.toLowerCase().startsWith('semester')) {
        rowErrors.push('Invalid semester (expected e.g. "Semester III")');
      }

      if (rawAtt === undefined || rawAtt === '' || Number.isNaN(attendancePercent)) {
        rowErrors.push('Attendance % must be numeric');
      } else if (attendancePercent < 0 || attendancePercent > 100) {
        rowErrors.push(`Attendance ${attendancePercent}% out of 0–100 range`);
      }

      return {
        rowNumber,
        rollNumber: rollNumber || '—',
        name: name || '—',
        className: className || '—',
        semester: semester || '—',
        attendancePercent: Number.isNaN(attendancePercent) ? 0 : Math.round(attendancePercent * 10) / 10,
        valid: rowErrors.length === 0,
        errors: rowErrors,
      };
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setImportNotice(null);
    setUploadFilename(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        throw new Error('The uploaded workbook has no worksheets.');
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
        defval: '',
      });
      if (rows.length === 0) {
        throw new Error('The uploaded worksheet is empty.');
      }
      setPreviewRows(validateRawRows(rows));
    } catch (err) {
      setPreviewRows(null);
      setParseError(err instanceof Error ? err.message : 'Unable to parse Excel file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleDownloadTemplate() {
    const sampleRows = [
      {
        rollNumber: '24CS010',
        name: 'Ishaan Kulkarni',
        className: 'SY B.Sc. Computer Science',
        semester: 'Semester III',
        attendancePercent: 88,
      },
      {
        rollNumber: '24CS011',
        name: 'Mehek Sharma',
        className: 'SY B.Sc. Computer Science',
        semester: 'Semester III',
        attendancePercent: 71,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'StudentsAttendance');
    XLSX.writeFile(wb, 'SIES_Student_Attendance_Template.xlsx');
  }

  function handleSimulateSampleUpload() {
    setParseError(null);
    setImportNotice(null);
    setUploadFilename('SY_CS_Attendance_Sample.xlsx');
    const simulatedRaw = [
      {
        rollNumber: '24CS015',
        name: 'Devika Nair',
        className: 'SY B.Sc. Computer Science',
        semester: 'Semester III',
        attendancePercent: 92,
      },
      {
        rollNumber: '24CS016',
        name: 'Raghav Menon',
        className: 'SY B.Sc. Computer Science',
        semester: 'Semester III',
        attendancePercent: 69,
      },
      {
        rollNumber: '24CS017',
        name: 'Zoya Khan',
        className: 'Unknown Class Name',
        semester: 'Semester III',
        attendancePercent: 112,
      },
      {
        rollNumber: '24CS015',
        name: 'Duplicate Entry',
        className: 'SY B.Sc. Computer Science',
        semester: 'Sem 3',
        attendancePercent: 80,
      },
    ];
    setPreviewRows(validateRawRows(simulatedRaw));
  }

  function handleDownloadErrorReport() {
    if (!previewRows) return;
    const bad = previewRows.filter((r) => !r.valid);
    const header = 'Row,Roll Number,Name,Class,Semester,Attendance %,Errors\n';
    const body = bad
      .map(
        (r) =>
          `${r.rowNumber},"${r.rollNumber}","${r.name}","${r.className}","${r.semester}",${r.attendancePercent},"${r.errors.join('; ')}"`
      )
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'SIES_Attendance_Import_Errors.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmImport() {
    if (!previewRows) return;
    const validCount = previewRows.filter((r) => r.valid).length;
    if (validCount === 0) return;

    setImporting(true);
    try {
      const res = await api.importStudentsAttendance(previewRows);
      setImportNotice(
        `Import complete: ${res.importedCount} new student(s) added and ${res.updatedCount} existing record(s) updated.` +
          (res.skipped.length > 0
            ? ` ${res.skipped.length} row(s) were skipped (row ${res.skipped[0].rowNumber}: ${res.skipped[0].errors[0]}).`
            : '')
      );
      setPreviewRows(null);
      setUploadFilename('');
      await loadStudents();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to commit student import.');
    } finally {
      setImporting(false);
    }
  }

  const validPreviewCount = previewRows?.filter((r) => r.valid).length ?? 0;
  const invalidPreviewRows = previewRows?.filter((r) => !r.valid) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-[#0F1B2D]">
          Students and Attendance
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Upload semester attendance spreadsheets (.xlsx / .csv) with row-level validation before importing.
        </p>
      </div>

      {/* Excel Upload Panel */}
      <section aria-labelledby="excel-upload-heading" className="bg-white border border-slate-300 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 id="excel-upload-heading" className="font-heading text-lg font-semibold text-[#0F1B2D] flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-[#0B6E79]" aria-hidden="true" />
              <span>Excel Attendance Upload</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Required columns: <span className="font-mono">rollNumber</span>,{' '}
              <span className="font-mono">name</span>, <span className="font-mono">className</span>,{' '}
              <span className="font-mono">semester</span>,{' '}
              <span className="font-mono">attendancePercent</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="min-h-[44px] px-3.5 py-2 border border-slate-400 bg-white hover:bg-slate-50 text-sm font-medium text-[#0F1B2D] inline-flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>Template .xlsx</span>
            </button>

            <button
              type="button"
              onClick={handleSimulateSampleUpload}
              className="min-h-[44px] px-3.5 py-2 border border-[#0B6E79] bg-[#E6F2F3] hover:bg-[#d7eaec] text-sm font-medium text-[#08545D] cursor-pointer"
            >
              Test Sample Preview &amp; Errors
            </button>

            <label className="min-h-[44px] px-4 py-2 bg-[#0B6E79] hover:bg-[#08545D] text-white text-sm font-medium inline-flex items-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Upload Excel / CSV</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {parseError && (
          <div role="alert" className="p-4 border border-red-700 bg-red-50 text-red-900 text-sm">
            {parseError}
          </div>
        )}

        {importNotice && (
          <div
            role="status"
            className="p-4 border border-emerald-700 bg-emerald-50 text-emerald-950 text-sm flex items-center gap-2.5"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-800 shrink-0" aria-hidden="true" />
            <span>{importNotice}</span>
          </div>
        )}

        {/* Preview & Error Report */}
        {previewRows && (
          <div className="border-t border-slate-200 pt-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-base font-bold text-[#0F1B2D]">
                  Import Preview: <span className="font-mono text-sm">{uploadFilename}</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5 tabular-nums">
                  {previewRows.length} rows scanned ·{' '}
                  <strong className="text-emerald-800">{validPreviewCount} valid</strong> ·{' '}
                  <strong className="text-red-700">{invalidPreviewRows.length} errors</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewRows(null)}
                aria-label="Discard upload preview"
                className="min-h-[44px] px-3 py-2 border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
                <span>Discard</span>
              </button>
            </div>

            {/* Error Report Panel */}
            {invalidPreviewRows.length > 0 && (
              <div
                role="region"
                aria-label="Spreadsheet validation error report"
                className="border border-red-700 bg-red-50 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-red-900 font-semibold text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Error Report ({invalidPreviewRows.length} rows excluded from import)</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadErrorReport}
                    className="min-h-[44px] px-3 py-1.5 border border-red-700 bg-white text-red-900 text-xs font-semibold hover:bg-red-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Download Error CSV</span>
                  </button>
                </div>
                <ul className="space-y-1.5 text-xs sm:text-sm text-red-950">
                  {invalidPreviewRows.map((row) => (
                    <li key={row.rowNumber} className="font-mono">
                      Row {row.rowNumber} ({row.rollNumber}): {row.errors.join(' · ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Preview Table */}
            <div className="overflow-x-auto border border-slate-300">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-[#EDF1F5] border-b border-slate-300 text-xs uppercase text-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Row</th>
                    <th className="py-2.5 px-3 font-semibold">Roll No</th>
                    <th className="py-2.5 px-3 font-semibold">Student Name</th>
                    <th className="py-2.5 px-3 font-semibold">Class</th>
                    <th className="py-2.5 px-3 font-semibold">Semester</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Attendance %</th>
                    <th className="py-2.5 px-3 font-semibold">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber} className={row.valid ? 'bg-white' : 'bg-red-50/70'}>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums">{row.rowNumber}</td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{row.rollNumber}</td>
                      <td className="py-2.5 px-3">{row.name}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.className}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.semester}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {row.attendancePercent}%
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {row.valid ? (
                          <span className="text-emerald-800 font-semibold">Valid</span>
                        ) : (
                          <span className="text-red-800 font-semibold">{row.errors.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={validPreviewCount === 0 || importing}
                onClick={handleConfirmImport}
                className="min-h-[44px] px-5 py-2.5 bg-[#0F1B2D] hover:bg-[#1A2B45] disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
              >
                {importing
                  ? 'Importing valid rows...'
                  : `Confirm Import (${validPreviewCount} valid row${validPreviewCount === 1 ? '' : 's'})`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-300 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search students by name or roll number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by roll number or student name..."
            className="w-full min-h-[44px] pl-10 pr-3.5 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
          />
        </div>
        <select
          aria-label="Filter students by class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="min-h-[44px] px-3.5 bg-white border border-slate-400 text-sm text-[#0F1B2D]"
        >
          <option value="ALL">All Classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <LoadingState label="Loading student attendance roster..." rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={loadStudents} />}

      {!loading && !error && filteredStudents.length === 0 && (
        <EmptyState
          title="No Students Found"
          description="No students match your search criteria or class filter."
          actionLabel="Clear Filters"
          onAction={() => {
            setSearch('');
            setClassFilter('ALL');
          }}
        />
      )}

      {!loading && !error && filteredStudents.length > 0 && (
        <div className="bg-white border border-slate-300 overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-[#EDF1F5] border-b border-slate-300 text-xs uppercase text-slate-700">
              <tr>
                <th className="py-3 px-4 font-semibold">Roll No</th>
                <th className="py-3 px-4 font-semibold">Student Name</th>
                <th className="py-3 px-4 font-semibold">Class &amp; Semester</th>
                <th className="py-3 px-4 font-semibold text-right">Attendance</th>
                <th className="py-3 px-4 font-semibold">Eligibility (75%)</th>
                <th className="py-3 px-4 font-semibold">Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStudents.map((stu) => {
                const eligible = stu.attendancePercent >= 75;
                return (
                  <tr key={stu.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[#0F1B2D]">
                      {stu.rollNumber}
                    </td>
                    <td className="py-3 px-4 font-medium text-[#0F1B2D]">{stu.name}</td>
                    <td className="py-3 px-4 text-slate-700">
                      <span>{stu.className}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-xs text-slate-500">{stu.semester}</span>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums font-semibold text-[#0F1B2D]">
                      {stu.attendancePercent}%
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-1 text-xs font-semibold border ${
                          eligible
                            ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                            : 'border-red-700 bg-red-50 text-red-900'
                        }`}
                      >
                        {eligible ? 'Eligible' : 'Below Minimum'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {stu.mustChangePassword ? 'First login pending' : 'Active'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
