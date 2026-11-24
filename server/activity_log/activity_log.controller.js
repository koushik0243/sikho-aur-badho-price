import express from 'express';
import * as ActivityLogHelper from './activity_log.service.js';
import { requester, SUPERADMIN } from '../middleware/accountAccess.js';

const Router = express.Router();

// GET /activity-log/list?userId= — a user's activity. Anyone may read their own; only a
// super admin may read someone else's (it used to return any user's log to any account).
const listActivity = async (req, res, next) => {
  try {
    const me = await requester(req);
    if (!me) return res.status(401).json({ status: 401, message: 'Please sign in again.' });
    const userId = req.query.userId ? String(req.query.userId) : me._id;
    if (userId !== me._id && me.user_type !== SUPERADMIN) {
      return res.status(403).json({ status: 403, message: 'Your account does not have access to this.' });
    }
    const data = await ActivityLogHelper.listActivity(userId);
    res.status(200).json({ status: 200, message: 'Successfully fetched.', data });
  } catch (error) {
    next(error);
  }
};

Router.get('/list', listActivity);

export default Router;
