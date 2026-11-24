import express from 'express';
import * as OrderHelper from './order.service.js';
import { purchaseCoursesForOrganization, updateCourseOrderPayment } from './order.course_purchase.js';
import { startRazorpayCheckout, confirmRazorpayPayment, cancelRazorpayCheckout, expireStaleCheckouts } from './order.razorpay_checkout.js';
import { razorpayPublicConfig } from './razorpay.js';
import { pageParams } from './order.list_sort.js';
import { requester, STORE_OWNER, SUPERADMIN } from '../middleware/accountAccess.js';

const Router = express.Router();

// A store owner only ever sees their own organization's orders, whatever filter is asked for.
async function scopedFilters(req) {
    const { status, organizer_id, credit_id, date_from, date_to } = req.query;
    const me = await requester(req);
    const orgId = me?.user_type === STORE_OWNER ? (me.orgId || '000000000000000000000000') : organizer_id;
    return { status, organizer_id: orgId, credit_id, date_from, date_to };
}

async function canSeeOrder(req, order) {
    const me = await requester(req);
    if (me?.user_type !== STORE_OWNER) return true;
    const orderOrg = String(order?.organizer_id?._id ?? order?.organizer_id ?? '');
    return Boolean(me.orgId) && orderOrg === String(me.orgId);
}

// POST /purchase-courses { orgId, items: [{ courseId, learners }], paymentMode, paymentDetails }
// Super admin only (Add Organization Course → Payment): buys for that organization with the
// payment it recorded; the order is recorded as the organization's own purchase.
// Store owners pay online instead (POST /razorpay/checkout).
const purchaseCoursesForOrg = async (req, res, next) => {
    try {
        const me = await requester(req);
        if (me?.user_type !== SUPERADMIN) {
            return res.status(403).json({ status: 403, message: 'Please pay online from your cart.' });
        }
        const data = await purchaseCoursesForOrganization({
            orgId: req.body?.orgId,
            items: req.body?.items,
            paymentMode: req.body?.paymentMode,
            paymentDetails: req.body?.paymentDetails,
        });
        res.status(200).json({ status: 200, message: "Order placed successfully.", data });
    } catch (error) {
        next(error);
    }
};

// ── Store owner cart → Razorpay (order.razorpay_checkout.js) ──────────────────────────
// GET  /razorpay/config               { configured, keyId, mode } — keyId is public
// POST /razorpay/checkout  { items }  priced pending order + Razorpay order to open Checkout
// POST /razorpay/verify    { orderId, razorpayOrderId, razorpayPaymentId, signature }
// POST /razorpay/cancel    { orderId }  Checkout closed without paying
async function ownOrgId(req) {
    const me = await requester(req);
    if (me?.user_type !== STORE_OWNER || !me.orgId) {
        const err = new Error('Only a store owner can pay for their cart.');
        err.statusCode = 403;
        throw err;
    }
    return me.orgId;
}

const razorpayConfig = (req, res) => {
    res.status(200).json({ status: 200, message: "Successfully fetched.", data: razorpayPublicConfig() });
};

const razorpayCheckout = async (req, res, next) => {
    try {
        const data = await startRazorpayCheckout({ orgId: await ownOrgId(req), items: req.body?.items });
        res.status(200).json({ status: 200, message: data.paid ? "Order placed successfully." : "Payment started.", data });
    } catch (error) {
        next(error);
    }
};

const razorpayVerify = async (req, res, next) => {
    try {
        const b = req.body || {};
        const data = await confirmRazorpayPayment({
            orgId: await ownOrgId(req),
            orderId: b.orderId,
            razorpayOrderId: b.razorpayOrderId,
            razorpayPaymentId: b.razorpayPaymentId,
            signature: b.signature,
        });
        res.status(200).json({ status: 200, message: "Payment successful. Order placed.", data });
    } catch (error) {
        next(error);
    }
};

const razorpayCancel = async (req, res, next) => {
    try {
        const data = await cancelRazorpayCheckout({ orgId: await ownOrgId(req), orderId: req.body?.orderId });
        res.status(200).json({ status: 200, message: "Payment canceled.", data });
    } catch (error) {
        next(error);
    }
};

// PUT /payment/:id { paymentMode, paymentDetails } — super admin only (the router's write
// policy): updates how a course order was paid, and its invoice.
const updateOrderPayment = async (req, res, next) => {
    try {
        const data = await updateCourseOrderPayment({
            orderId: req.params.id,
            paymentMode: req.body?.paymentMode,
            paymentDetails: req.body?.paymentDetails,
        });
        res.status(200).json({ status: 200, message: "Payment details updated.", data });
    } catch (error) {
        next(error);
    }
};

const createOrder = async (req, res, next) => {
    try {
        const data = await OrderHelper.createOrder(req.body);
        res.status(200).json({ status: 200, message: "Successfully added.", data });
    } catch (error) {
        next(error);
    }
};

const editOrder = async (req, res, next) => {
    try {
        const data = await OrderHelper.editOrder(req.params.id);
        if (!data || !(await canSeeOrder(req, data))) {
            return res.status(404).json({ status: 404, message: "Order not found." });
        }
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

const updateOrder = async (req, res, next) => {
    try {
        const data = await OrderHelper.updateOrder(req.params.id, req.body);
        res.status(200).json({ status: 200, message: "Successfully updated.", data });
    } catch (error) {
        next(error);
    }
};

const listOrder = async (req, res, next) => {
    try {
        const filters = await scopedFilters(req);
        await expireStaleCheckouts(filters.organizer_id || null); // abandoned checkouts show as canceled
        const data = await OrderHelper.listOrder(filters);
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

// GET /list-pagination?page&limit&sort&dir + the /list filters — one page of orders, sorted
// on the server (sort keys: ORDER_SORTS in order.service.js; default newest purchase first).
const listOrderPagination = async (req, res, next) => {
    try {
        const { page, limit, sort, dir } = pageParams(req.query);
        const filters = await scopedFilters(req);
        await expireStaleCheckouts(filters.organizer_id || null); // abandoned checkouts show as canceled

        const [orders, total] = await Promise.all([
            OrderHelper.listOrderPagination(page, limit, filters, { sort, dir }),
            OrderHelper.getOrderCount(filters),
        ]);
        res.status(200).json({
            status: 200,
            message: "Successfully fetched.",
            data: orders,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
        });
    } catch (error) {
        next(error);
    }
};

const deleteOrder = async (req, res, next) => {
    try {
        const data = await OrderHelper.deleteOrder(req.params.id);
        res.status(200).json({ status: 200, message: "Successfully deleted.", data });
    } catch (error) {
        next(error);
    }
};

Router.post('/create',           createOrder);
Router.post('/purchase-courses', purchaseCoursesForOrg);
Router.get('/razorpay/config',    razorpayConfig);
Router.post('/razorpay/checkout', razorpayCheckout);
Router.post('/razorpay/verify',   razorpayVerify);
Router.post('/razorpay/cancel',   razorpayCancel);
Router.get('/list',              listOrder);
Router.get('/list-pagination',   listOrderPagination);
Router.get('/edit/:id',          editOrder);
Router.put('/update/:id',        updateOrder);
Router.put('/payment/:id',       updateOrderPayment);
Router.get('/delete/:id',        deleteOrder);
Router.get('/:id',               editOrder);

export default Router;
