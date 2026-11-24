import express from 'express';
import { listOrgSeats, listAllSeats } from './course_seat.service.js';
import { requester, STORE_OWNER, SUPERADMIN } from '../middleware/accountAccess.js';

const Router = express.Router();

// GET /course-seat/list?orgId= — learners purchased / used / available per course.
// A store owner always gets their own organization's seats.
const listSeats = async (req, res, next) => {
    try {
        const me = await requester(req);
        const orgId = me?.user_type === STORE_OWNER ? me.orgId : req.query.orgId;
        const data = await listOrgSeats(orgId);
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

// GET /course-seat/list-all — every organization's seats (super admin only).
const listEverySeat = async (req, res, next) => {
    try {
        const me = await requester(req);
        if (me?.user_type !== SUPERADMIN) {
            return res.status(403).json({ status: 403, message: 'Your account does not have access to this.' });
        }
        const data = await listAllSeats();
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

Router.get('/list', listSeats);
Router.get('/list-all', listEverySeat);

export default Router;
