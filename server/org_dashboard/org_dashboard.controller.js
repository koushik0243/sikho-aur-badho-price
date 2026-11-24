import express from 'express';
import * as OrgDashboardHelper from './org_dashboard.service.js';
import { requester, STORE_OWNER } from '../middleware/accountAccess.js';
import { cachedReport } from '../_helpers/reportCache.js';

const Router = express.Router();

// Every store owner's dashboard loads this on sign-in; it is reused for a few seconds and
// concurrent loads share one build (_helpers/reportCache.js).
const getDashboardSummary = cachedReport('org-dashboard:summary', 20 * 1000,
    ({ orgId }) => OrgDashboardHelper.getDashboardSummary(orgId));

// A store owner always gets their own organization's dashboard, whatever ?orgId= says;
// a super admin may pick any organization.
const getSummary = async (req, res, next) => {
    try {
        const me = await requester(req);
        const orgId = me?.user_type === STORE_OWNER ? String(me.orgId || '') : String(req.query.orgId || '');
        const data = await getDashboardSummary({ orgId });
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

Router.get('/summary', getSummary);

export default Router;
