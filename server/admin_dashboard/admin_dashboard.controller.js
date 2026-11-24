import express from 'express';
import { getAdminDashboardSummary } from './admin_dashboard.service.js';
import { cachedReport } from '../_helpers/reportCache.js';

// Super admin only (mounted behind protect + requireSuperAdmin in app.js).
const Router = express.Router();

const getSummary = cachedReport('admin-dashboard:summary', 30 * 1000, () => getAdminDashboardSummary());

// GET /admin-dashboard/summary — KPI counts, revenue, recent orders, organization overview
Router.get('/summary', async (req, res, next) => {
  try {
    const data = await getSummary({});
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) {
    next(error);
  }
});

export default Router;
