import express from 'express';
import { getRevenueReport as getRevenueReportUncached } from './report.service.js';
import { getStoreOwnerReport as getStoreOwnerReportUncached } from './store_owner_report.service.js';
import { getTraineeReport as getTraineeReportUncached } from './trainee_report.service.js';
import { getTestPerformanceReport as getTestPerformanceReportUncached } from './test_performance_report.service.js';
import { getChapterQualityReport as getChapterQualityReportUncached } from './chapter_quality_report.service.js';
import { getTopOrganizationsReport as getTopOrganizationsReportUncached } from './top_organizations_report.service.js';
import { getPlatformHealthReport as getPlatformHealthReportUncached } from './platform_health_report.service.js';
import mongoose from 'mongoose';
import { cachedReport } from '../_helpers/reportCache.js';

// Reports are reused briefly and concurrent identical requests share one build (_helpers/reportCache.js).
const getRevenueReport = cachedReport('sa:getRevenueReport', 60 * 1000, getRevenueReportUncached);
const getStoreOwnerReport = cachedReport('sa:getStoreOwnerReport', 60 * 1000, getStoreOwnerReportUncached);
const getTraineeReport = cachedReport('sa:getTraineeReport', 60 * 1000, getTraineeReportUncached);
const getTestPerformanceReport = cachedReport('sa:getTestPerformanceReport', 60 * 1000, getTestPerformanceReportUncached);
const getChapterQualityReport = cachedReport('sa:getChapterQualityReport', 60 * 1000, getChapterQualityReportUncached);
const getTopOrganizationsReport = cachedReport('sa:getTopOrganizationsReport', 60 * 1000, getTopOrganizationsReportUncached);
const getPlatformHealthReport = cachedReport('sa:getPlatformHealthReport', 60 * 1000, getPlatformHealthReportUncached);

// Super admin reports (mounted behind protect + requireSuperAdmin in app.js).
const Router = express.Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (ymd) => DATE.test(ymd) && !Number.isNaN(new Date(`${ymd}T00:00:00Z`).getTime())
  && new Date(`${ymd}T00:00:00Z`).toISOString().slice(0, 10) === ymd;
const badRequest = (res, message) => res.status(400).json({ status: 400, message });

const param = (v) => (typeof v === 'string' && v ? v : undefined);

/** Validates ?from=&to= (YYYY-MM-DD, optional); returns an error message or null. */
function checkPeriod(from, to) {
  if (from && !isRealDate(from)) return 'from must be a date (YYYY-MM-DD).';
  if (to && !isRealDate(to)) return 'to must be a date (YYYY-MM-DD).';
  if (from && to && from > to) return 'The start date must be on or before the end date.';
  return null;
}

// GET /report/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD — revenue (monthly/daily), AOV, course-wise revenue
const revenueReport = async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    const periodError = checkPeriod(from, to);
    if (periodError) return badRequest(res, periodError);

    const data = await getRevenueReport({ from, to });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

// GET /report/store-owners?from=YYYY-MM-DD&to=YYYY-MM-DD — organizations registered in the period
const storeOwnerReport = async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    const periodError = checkPeriod(from, to);
    if (periodError) return badRequest(res, periodError);
    const data = await getStoreOwnerReport({ from, to });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

/** A report filtered by ?from=&to=&orgId=&courseId= (all optional). */
const orgCourseReport = (load) => async (req, res, next) => {
  try {
    const from = param(req.query.from), to = param(req.query.to);
    const orgId = param(req.query.orgId), courseId = param(req.query.courseId);
    const periodError = checkPeriod(from, to);
    if (periodError) return badRequest(res, periodError);
    if (orgId && !mongoose.isValidObjectId(orgId)) return badRequest(res, 'Invalid organization.');
    if (courseId && !mongoose.isValidObjectId(courseId)) return badRequest(res, 'Invalid course.');
    const data = await load({ from, to, orgId, courseId });
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) { next(error); }
};

// GET /report/trainees — enrollments in the period
const traineeReport = orgCourseReport(getTraineeReport);
// GET /report/test-performance — quiz / aptitude results, homework, Zoom, completion time
const testPerformanceReport = orgCourseReport(getTestPerformanceReport);
// GET /report/chapter-quality — weak / difficult chapters, failed + skipped questions, content issues
const chapterQualityReport = orgCourseReport(getChapterQualityReport);
// GET /report/top-organizations — top 10 by revenue / enrollments, VIP customers
const topOrganizationsReport = orgCourseReport(getTopOrganizationsReport);
// GET /report/platform-health — DAU, MTD / YTD revenue, certificates, course + organization ranking
const platformHealthReport = orgCourseReport(getPlatformHealthReport);

Router.get('/revenue', revenueReport);
Router.get('/trainees', traineeReport);
Router.get('/test-performance', testPerformanceReport);
Router.get('/chapter-quality', chapterQualityReport);
Router.get('/top-organizations', topOrganizationsReport);
Router.get('/platform-health', platformHealthReport);
Router.get('/store-owners', storeOwnerReport);

export default Router;
