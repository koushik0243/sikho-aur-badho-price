import express from 'express';
import mongoose from 'mongoose';
import { requireSuperAdmin } from '../middleware/authMiddleware.js';
import { getGstPercent, setGstPercent, parseGstPercent, MAX_GST_PERCENT } from './setting.service.js';

// GET /gst  { gst_percent }  read by the store owner cart and the super admin Edit User page
// PUT /gst  { gst_percent }  super admin only
const Router = express.Router();

const getGst = async (req, res, next) => {
    try {
        const gst_percent = await getGstPercent();
        res.status(200).json({ status: 200, message: 'Successfully fetched.', data: { gst_percent } });
    } catch (error) { next(error); }
};

const updateGst = async (req, res, next) => {
    try {
        const percent = parseGstPercent(req.body?.gst_percent);
        if (percent === null) {
            return res.status(400).json({ status: 400, message: `GST must be a number from 0 to ${MAX_GST_PERCENT}.` });
        }
        const userId = mongoose.isValidObjectId(req.user?._id) ? req.user._id : null;
        const gst_percent = await setGstPercent(percent, userId);
        res.status(200).json({ status: 200, message: 'GST updated.', data: { gst_percent } });
    } catch (error) { next(error); }
};

Router.get('/gst', getGst);
Router.put('/gst', requireSuperAdmin, updateGst);

export default Router;
