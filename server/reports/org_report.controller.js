import express from 'express';
import mongoose from 'mongoose';
import { getOrgEmployeesReport as getOrgEmployeesReportUncached } from './org_employees_report.service.js';
import { getOrgProgressReport as getOrgProgressReportUncached } from './org_progress_report.service.js';
import { getOrgTestResultsReport as getOrgTestResultsReportUncached } from './org_test_results_report.service.js';
import { getOrgPurchasesReport } from './org_purchases_report.service.js';
import { getOrgSummaryReport as getOrgSummaryReportUncached } from './org_summary_report.service.js';
import { EXPORT_KEYS, getOrgExportCounts as getOrgExportCountsUncached, getOrgExportRows as getOrgExportRowsUncached } from './org_exports_report.service.js';
import { readPaging, pageSections, DONE_FILTERS } from './org_report_paging.js';
import { cachedReport } from '../_helpers/reportCache.js';

// Reports are reused briefly and concurrent identical requests share one build (_helpers/reportCache.js).
const getOrgEmployeesReport = cachedReport('org:getOrgEmployeesReport', 30 * 1000, getOrgEmployeesReportUncached);
const getOrgProgressReport = cachedReport('org:getOrgProgressReport', 30 * 1000, getOrgProgressReportUncached);
const getOrgTestResultsReport = cachedReport('org:getOrgTestResultsReport', 30 * 1000, getOrgTestResultsReportUncached);
const getOrgSummaryReport = cachedReport('org:getOrgSummaryReport', 30 * 1000, getOrgSummaryReportUncached);
const getOrgExportCounts = cachedReport('org:getOrgExportCounts', 30 * 1000, getOrgExportCountsUncached);
const getOrgExportRows = cachedReport('org:getOrgExportRows', 30 * 1000, getOrgExportRowsUncached);

// The tables each report pages with ?limit=&page=&<table>Page= (org_report_paging.js; without
// them the full report is sent). The full report is cached per filter
// set, so moving between pages only slices the cached report — nothing is rebuilt.
const MISSING_PREVIEW = 20; // names listed per Zoom session / homework on a page (the PDF lists all)
const previewMissing = (row) => ({ ...row, missing: row.missing.slice(0, MISSING_PREVIEW), missingCount: row.missing.length });
const EMPLOYEE_FILTERS = {
  all: () => true,
  active: e => e.activity === 'active',
  inactive: e => e.activity === 'inactive',
  alerts: e => e.alerts.length > 0,
};
// The employee filter only needs names (the full list keeps emails: the learner's own report uses them).
const employeeNamesOnly = (r) => ({ ...r, options: { ...r.options, employees: r.options.employees.map(({ id, name }) => ({ id, name })) } });
const PAGED = {
  progress: [{ key: 'enrollments' }, { key: 'chapterRows' }],
  summary: [
    { key: 'employees' },
    { key: 'zoomSessions', mapRow: previewMissing },
    { key: 'zoomRows', filters: DONE_FILTERS },
    { key: 'homeworkItems', mapRow: previewMissing },
    { key: 'homeworkRows', filters: DONE_FILTERS },
  ],
  employees: [{ key: 'alerts' }, { key: 'employees', filters: EMPLOYEE_FILTERS }, { key: 'enrollments' }, { key: 'certificates' }],
  testResults: [{ key: 'perEmployee' }, { key: 'chapterRows' }, { key: 'attempts' }, { key: 'aptitude' }],
};

// Store owner reports. The organization always comes from the signed-in
// owner's own account — never from the request — so an owner only sees their
// own organization.
const Router = express.Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const param = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isRealDate = (s) => {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-13-01, 2026-02-30
};
const badRequest = (res, message) => res.status(400).json({ status: 400, message });

/**
 * Builds (or reuses) the full report, then answers with one page of each table — or the
 * full report when no paging params are sent (the PDF export asks for that).
 * An invalid paging param is answered with 400 before any work is done.
 * `pageView` trims what a page view does not show (never applied to the full report).
 */
const sendReport = async (req, res, sections, build, pageView = (r) => r) => {
  let paging;
  try {
    paging = readPaging(req.query, sections);
  } catch (error) {
    if (error.status === 400) return badRequest(res, error.message);
    throw error;
  }
  const report = await build();
  const data = paging ? pageView(pageSections(report, sections, paging)) : report;
  res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
};

/** Use after `protect`: only an organization owner may continue; sets req.orgId. */
const requireOrgOwner = async (req, res, next) => {
  try {
    const id = req.user?._id;
    if (!mongoose.isValidObjectId(id)) return res.status(403).json({ status: 403, message: 'Only a store owner can view this report.' });
    const user = await mongoose.connection.db.collection('users').findOne(
      { _id: new mongoose.Types.ObjectId(id), deletedAt: null },
      { projection: { user_type: 1, orgId: 1, status: 1 } },
    );
    if (!user || user.user_type !== 'organization' || !user.orgId) {
      return res.status(403).json({ status: 403, message: 'Only a store owner can view this report.' });
    }
    req.orgId = String(user.orgId);
    next();
  } catch (error) { next(error); }
};

// GET /org-report/employees?from=&to= — my organization's employees
//   paged tables: alerts, employees (+ employeesFilter=active|inactive|alerts), enrollments, certificates
const employeesReport = async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    if ((from && !isRealDate(from)) || (to && !isRealDate(to))) return badRequest(res, 'Dates must be real dates in YYYY-MM-DD format.');
    if (from && to && from > to) return badRequest(res, 'The start date must be on or before the end date.');
    await sendReport(req, res, PAGED.employees, () => getOrgEmployeesReport({ orgId: req.orgId, from, to }));
  } catch (error) { next(error); }
};

// GET /org-report/progress?learnerId=&courseId= — chapter / phase progress per employee
//   paged tables: enrollments, chapterRows
const progressReport = async (req, res, next) => {
  try {
    const learnerId = param(req.query.learnerId), courseId = param(req.query.courseId);
    if (learnerId && !mongoose.isValidObjectId(learnerId)) return badRequest(res, 'Invalid employee.');
    if (courseId && !mongoose.isValidObjectId(courseId)) return badRequest(res, 'Invalid course.');
    await sendReport(req, res, PAGED.progress, () => getOrgProgressReport({ orgId: req.orgId, learnerId, courseId }), employeeNamesOnly);
  } catch (error) { next(error); }
};

// GET /org-report/test-results?from=&to=&learnerId=&courseId= — quiz / aptitude results
//   paged tables: perEmployee, chapterRows, attempts, aptitude
const testResultsReport = async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    const learnerId = param(req.query.learnerId), courseId = param(req.query.courseId);
    if ((from && !isRealDate(from)) || (to && !isRealDate(to))) return badRequest(res, 'Dates must be real dates in YYYY-MM-DD format.');
    if (from && to && from > to) return badRequest(res, 'The start date must be on or before the end date.');
    if (learnerId && !mongoose.isValidObjectId(learnerId)) return badRequest(res, 'Invalid employee.');
    if (courseId && !mongoose.isValidObjectId(courseId)) return badRequest(res, 'Invalid course.');
    await sendReport(req, res, PAGED.testResults, () => getOrgTestResultsReport({ orgId: req.orgId, from, to, learnerId, courseId }));
  } catch (error) { next(error); }
};

// GET /org-report/purchases?from=&to= — credits bought / used / remaining, invoices
const purchasesReport = async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    if ((from && !isRealDate(from)) || (to && !isRealDate(to))) return badRequest(res, 'Dates must be real dates in YYYY-MM-DD format.');
    if (from && to && from > to) return badRequest(res, 'The start date must be on or before the end date.');
    const data = await getOrgPurchasesReport({ orgId: req.orgId, from, to });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

// GET /org-report/summary?courseId= — completion %, best / weak performers, Zoom + homework
//   paged tables: employees, zoomSessions, zoomRows (+ zoomRowsFilter=done|not), homeworkItems, homeworkRows (+ homeworkRowsFilter)
const summaryReport = async (req, res, next) => {
  try {
    const courseId = param(req.query.courseId);
    if (courseId && !mongoose.isValidObjectId(courseId)) return badRequest(res, 'Invalid course.');
    await sendReport(req, res, PAGED.summary, () => getOrgSummaryReport({ orgId: req.orgId, courseId }));
  } catch (error) { next(error); }
};

// GET /org-report/exports — the counts shown on the Reports (downloads) page
const exportCounts = async (req, res, next) => {
  try {
    const data = await getOrgExportCounts({ orgId: req.orgId });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

// GET /org-report/exports/:key — the rows of one download (completion | performers | failure | zoom | certificates)
const exportRows = async (req, res, next) => {
  try {
    const { key } = req.params;
    if (!EXPORT_KEYS.includes(key)) return badRequest(res, 'Unknown report.');
    const data = await getOrgExportRows({ orgId: req.orgId, key });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

Router.use(requireOrgOwner);
Router.get('/employees', employeesReport);
Router.get('/progress', progressReport);
Router.get('/test-results', testResultsReport);
Router.get('/purchases', purchasesReport);
Router.get('/summary', summaryReport);
Router.get('/exports', exportCounts);
Router.get('/exports/:key', exportRows);

export default Router;
