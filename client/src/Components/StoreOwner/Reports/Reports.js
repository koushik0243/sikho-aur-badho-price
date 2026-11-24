'use client';

import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { selectUser } from '../../../redux/slices/authSlice';
import { toast } from 'sonner';
import apiServiceHandler from '../../../service/apiService';
import s from "./Reports.module.css";

const DownloadIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" />
  </svg>
);

const Icon = {
  book:      <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" /></svg>,
  users:     <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" /></svg>,
  clipboard: <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
  link:      <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" /></svg>,
  trophy:    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h8V3a1 1 0 112 0v1h1a1 1 0 011 1v2a4 4 0 01-3.6 3.98A5.002 5.002 0 0111 13.9V16h2a1 1 0 110 2H7a1 1 0 110-2h2v-2.1a5.002 5.002 0 01-3.4-2.92A4 4 0 012 7V5a1 1 0 011-1h1V3a1 1 0 011-1zm-1 4v1a2 2 0 001.1 1.79A5 5 0 015 7V6H4zm11 1V6h1v1a2 2 0 01-1.1 1.79c.07-.26.1-.52.1-.79z" clipRule="evenodd" /></svg>,
  alert:     <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>,
  video:     <svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>,
  badge:     <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>,
};

function downloadCsv(filename, rows) {
  const csv  = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// colDefs: [{ key, label, width }]  — width in px (×0.75 → pt internally in jsPDF)
async function downloadPdf(filename, title, colDefs, dataRows) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 123, 123);
  doc.text(title, 40, 40);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(130, 130, 130);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 40, 56);
  doc.setTextColor(0, 0, 0);

  if (dataRows.length === 0) {
    doc.setFontSize(11);
    doc.setTextColor(180, 180, 180);
    doc.text('No data available.', 40, 80);
  } else {
    const headers  = colDefs.map(c => ({ name: c.key, prompt: c.label, width: c.width, align: 'left' }));
    const tableData = dataRows.map(row => {
      const obj = {};
      colDefs.forEach((c, i) => { obj[c.key] = String(row[i] ?? '') || ' '; });
      return obj;
    });
    doc.table(40, 68, tableData, headers, { fontSize: 9 });
  }

  doc.save(filename);
}

const dateText = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '');

// What each download contains. The rows come from GET org-report/exports/<key>, built on the
// server only when the owner clicks a download (the page itself loads just the four counts).
// columns: { key, label, width (PDF, px), value(row) } — the CSV and the PDF use the same columns.
const assignmentColumns = (widths) => [
  { key: 'n',  label: 'Learner Name',    width: widths[0], value: r => r.name },
  { key: 'e',  label: 'Email',           width: widths[1], value: r => r.email },
  { key: 'c',  label: 'Course',          width: widths[2], value: r => r.course },
  { key: 'ad', label: 'Assigned Date',   width: widths[3], value: r => dateText(r.assignedAt) },
  { key: 'cd', label: 'Completion Date', width: widths[4], value: r => dateText(r.lastAttemptAt) },
];
const EXPORTS = {
  completion: { file: 'course_completion', title: 'Course Completion Report', columns: assignmentColumns([180, 225, 280, 160, 170]) },
  performers: {
    file: 'performers', title: 'Top / Bottom Performers',
    columns: [
      { key: 'n',  label: 'Learner Name', width: 145, value: r => r.name },
      { key: 'e',  label: 'Email',        width: 190, value: r => r.email },
      { key: 'c',  label: 'Course',       width: 190, value: r => r.course },
      { key: 'qt', label: 'Quiz Topic',   width: 190, value: r => r.quiz },
      { key: 's',  label: 'Score',        width: 85,  value: r => r.score ?? '' },
      { key: 'p',  label: 'Passed',       width: 85,  value: r => (r.passed ? 'Yes' : 'No') },
      { key: 'd',  label: 'Date',         width: 130, value: r => dateText(r.takenAt) },
    ],
  },
  failure: {
    file: 'chapter_failure', title: 'Chapter Failure Analysis',
    columns: [
      { key: 'crs',   label: 'Course',         width: 210, value: r => r.course },
      { key: 'ch',    label: 'Chapter',        width: 210, value: r => r.chapter },
      { key: 'qt',    label: 'Quiz Topic',     width: 210, value: r => r.quiz },
      { key: 'total', label: 'Total Attempts', width: 135, value: r => r.total },
      { key: 'fail',  label: 'Failed',         width: 115, value: r => r.failed },
      { key: 'rate',  label: 'Failure Rate %', width: 135, value: r => `${r.total > 0 ? Math.round((r.failed / r.total) * 100) : 0}%` },
    ],
  },
  zoom: {
    file: 'zoom_attendance', title: 'Zoom Attendance Log',
    columns: [
      { key: 'n', label: 'Learner Name',     width: 320, value: r => r.name },
      { key: 'e', label: 'Email',            width: 475, value: r => r.email },
      { key: 'x', label: 'Courses Assigned', width: 220, value: r => r.assigned },
    ],
  },
  certificates: { file: 'certificate_log', title: 'Certificate Issuance Log', columns: assignmentColumns([180, 235, 280, 155, 165]) },
};

/** The rows of one download, as table cells. */
async function loadExport(key) {
  const res = await apiServiceHandler('GET', `org-report/exports/${key}?t=${Date.now()}`);
  if (!Array.isArray(res?.data?.rows)) throw new Error('The report could not be loaded.');
  return res.data.rows.map(row => EXPORTS[key].columns.map(c => c.value(row)));
}

export default function ReportsPage() {
  const user = useSelector(selectUser);
  const userId = user?._id;

  const [loading,   setLoading]   = useState(true);
  const [counts,    setCounts]    = useState(null);
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Only the four counts: the organization comes from the signed-in owner on the server.
        const res = await apiServiceHandler('GET', 'org-report/exports');
        if (!cancelled) setCounts(res?.data || null);
      } catch (err) {
        if (!cancelled) toast.warning(err?.message || 'Could not load the report counts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (userId) load();
    return () => { cancelled = true; };
  }, [userId]);

  async function download(key, format) {
    setExporting(format === 'pdf' ? `${key}_pdf` : key);
    try {
      const { file, title, columns } = EXPORTS[key];
      const rows = await loadExport(key);
      if (format === 'pdf') await downloadPdf(`${file}.pdf`, title, columns, rows);
      else downloadCsv(`${file}.csv`, [columns.map(c => c.label), ...rows]);
    } catch (err) {
      toast.warning(err?.message || 'Could not create the download. Please try again.');
    } finally {
      setExporting(null);
    }
  }
  const handleCsv = (key) => download(key, 'csv');
  const handlePdf = (key) => download(key, 'pdf');

  const courseCount  = counts?.courses ?? 0;
  const learnerCount = counts?.learners ?? 0;
  const attemptCount = counts?.quizAttempts ?? 0;
  const assignCount  = counts?.assignments ?? 0;

  const REPORTS = [
    {
      key: 'completion', icon: Icon.book,
      title: 'Course Completion Report',
      desc: 'Every learner’s assigned courses, with the assigned date and latest activity date.',
      sub: `${courseCount} course${courseCount !== 1 ? 's' : ''} · ${learnerCount} learner${learnerCount !== 1 ? 's' : ''}`,
    },
    {
      key: 'performers', icon: Icon.trophy,
      title: 'Top / Bottom Performers',
      desc: 'All quiz attempts ranked by score — spot your strongest and weakest learners.',
      sub: `${attemptCount} quiz attempt${attemptCount !== 1 ? 's' : ''} · Ranked by score`,
    },
    {
      key: 'failure', icon: Icon.alert,
      title: 'Chapter Failure Analysis',
      desc: 'Attempts, failures and fail rate for each quiz, by course and chapter.',
      sub: `Retry rates · ${attemptCount} total attempt${attemptCount !== 1 ? 's' : ''}`,
    },
    {
      key: 'zoom', icon: Icon.video,
      title: 'Zoom Attendance Log',
      desc: 'Each learner with their email and the number of courses assigned to them.',
      sub: `${learnerCount} learner${learnerCount !== 1 ? 's' : ''} · Session-wise records`,
    },
    {
      key: 'certificates', icon: Icon.badge,
      title: 'Certificate Issuance Log',
      desc: 'Each course assignment with its assigned date and completion date.',
      sub: `${assignCount} assignment${assignCount !== 1 ? 's' : ''} · Who earned what · When`,
    },
  ];

  const KPIS = [
    { label: 'Courses',       value: courseCount,  icon: Icon.book },
    { label: 'Learners',      value: learnerCount, icon: Icon.users },
    { label: 'Quiz attempts', value: attemptCount, icon: Icon.clipboard },
    { label: 'Assignments',   value: assignCount,  icon: Icon.link },
  ];

  return (
    <div className={s.page}>
      <header className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>Reports</h1>
          <p className={s.pageSub}>Export your organisation’s learning data as CSV (for spreadsheets) or PDF (for sharing).</p>
        </div>
        {loading && <span className={s.loadingNote} role="status">Loading data…</span>}
      </header>

      <section className={s.kpis} aria-label="Data included in the reports">
        {KPIS.map(k => (
          <div key={k.label} className={s.kpi}>
            <span className={s.kpiIcon} aria-hidden="true">{k.icon}</span>
            <div>
              <div className={s.kpiValue}>{loading ? '—' : k.value}</div>
              <div className={s.kpiLabel}>{k.label}</div>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="rp-export-h">
        <h2 id="rp-export-h" className={s.sectionTitle}>Export reports</h2>
        <div className={s.reportGrid}>
          {REPORTS.map(r => {
            const busy = exporting === r.key || exporting === `${r.key}_pdf`;
            return (
              <article key={r.key} className={s.reportCard}>
                <div className={s.reportHead}>
                  <span className={s.reportIcon} aria-hidden="true">{r.icon}</span>
                  <div className={s.reportText}>
                    <h3 className={s.reportTitle}>{r.title}</h3>
                    <p className={s.reportSub}>{loading ? 'Loading…' : r.sub}</p>
                  </div>
                </div>
                <p className={s.reportDesc}>{r.desc}</p>
                <div className={s.reportActions}>
                  <button
                    suppressHydrationWarning
                    className={s.btnCsv}
                    disabled={loading || busy}
                    onClick={() => handleCsv(r.key)}
                    aria-label={`Download ${r.title} as CSV`}
                  >
                    <DownloadIcon /> {exporting === r.key ? 'Preparing…' : 'CSV'}
                  </button>
                  <button
                    suppressHydrationWarning
                    className={s.btnPdf}
                    disabled={loading || busy}
                    onClick={() => handlePdf(r.key)}
                    aria-label={`Download ${r.title} as PDF`}
                  >
                    <DownloadIcon /> {exporting === `${r.key}_pdf` ? 'Preparing…' : 'PDF'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
