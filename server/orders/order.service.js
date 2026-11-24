import mongoose from 'mongoose';
import Order from './order.model.js';
import {
    dateOrEpoch, lowerOrEmpty, numberOrZero, orderItemLabelStages, orgNameSort, sortedPageStages,
} from './order.list_sort.js';

const { ObjectId } = mongoose.Types;

const buildQuery = (filters = {}) => {
    const query = { deletedAt: null };
    if (filters.status) query.status = filters.status;
    if (filters.organizer_id && ObjectId.isValid(filters.organizer_id))
        query.organizer_id = new ObjectId(filters.organizer_id);
    if (filters.credit_id && ObjectId.isValid(filters.credit_id))
        query.credit_id = new ObjectId(filters.credit_id);
    // Purchase date range (ISO timestamps; either end optional, both inclusive).
    const from = filters.date_from ? new Date(filters.date_from) : null;
    const to   = filters.date_to ? new Date(filters.date_to) : null;
    if ((from && !isNaN(from)) || (to && !isNaN(to))) {
        query.purchase_date = {};
        if (from && !isNaN(from)) query.purchase_date.$gte = from;
        if (to && !isNaN(to)) query.purchase_date.$lte = to;
    }
    return query;
};

// Same refs for a query (.populate) and for aggregated rows (Order.populate).
const POPULATE_REFS = [
    { path: 'organizer_id', select: '_id org_name org_email' },
    { path: 'credit_id', select: '_id title price limit_from limit_to' },
];

const populateRefs = (q) => q.populate(POPULATE_REFS);

// Sortable columns of the super admin Orders list (sort=<key>, keys match the client's
// columns); anything else falls back to the default order.
const ORDER_SORTS = {
    org_name:        orgNameSort('organizer_id'),
    credit_title:    { stages: orderItemLabelStages(), key: { $toLower: '$_sort_item' } },
    credit_amount:   { key: numberOrZero('$credit_amount') },
    purchase_date:   { key: dateOrEpoch('$purchase_date') },
    payment_gateway: { key: lowerOrEmpty('$payment_gateway') },
};
// Default: most recent purchase first.
const ORDER_DEFAULT_SORT = { sort: { purchase_date: -1 } };

export const createOrder = async (data) => {
    try {
        return await new Order({
            organizer_id:    data.organizer_id,
            credit_id:       data.credit_id,
            credit_amount:   Number(data.credit_amount ?? 0),
            purchase_date:   data.purchase_date || new Date(),
            payment_gateway: data.payment_gateway || 'manual',
            status:          data.status || 'active',
        }).save();
    } catch (error) {
        throw error;
    }
};

export const editOrder = async (id) => {
    try {
        return await populateRefs(Order.findOne({ _id: id, deletedAt: null })).lean();
    } catch (error) {
        throw error;
    }
};

export const updateOrder = async (id, data) => {
    try {
        const fields = ['organizer_id', 'credit_id', 'credit_amount', 'purchase_date', 'payment_gateway', 'status'];
        const updateFields = {};
        for (const f of fields) {
            if (data[f] !== undefined) updateFields[f] = data[f];
        }
        if (!Object.keys(updateFields).length)
            return await populateRefs(Order.findOne({ _id: id, deletedAt: null })).lean();

        updateFields.updatedAt = new Date();
        return await Order.findOneAndUpdate(
            { _id: id, deletedAt: null },
            { $set: updateFields },
            { returnDocument: 'after', runValidators: true }
        ).lean();
    } catch (error) {
        throw error;
    }
};

export const listOrder = async (filters = {}) => {
    try {
        return await populateRefs(Order.find(buildQuery(filters)).sort({ createdAt: -1 })).lean();
    } catch (error) {
        throw error;
    }
};

/**
 * One page of orders, sorted on the server by a whitelisted column (ORDER_SORTS, ascending
 * unless dir is 'desc'); rows come back populated like listOrder's.
 */
export const listOrderPagination = async (page, limit, filters = {}, { sort, dir } = {}) => {
    try {
        const spec = Object.hasOwn(ORDER_SORTS, sort) ? ORDER_SORTS[sort] : ORDER_DEFAULT_SORT;
        const rows = await Order.aggregate([
            { $match: buildQuery(filters) },
            ...sortedPageStages(spec, dir, page, limit),
        ]);
        return await Order.populate(rows, POPULATE_REFS.map(ref => ({ ...ref, options: { lean: true } })));
    } catch (error) {
        throw error;
    }
};

export const getOrderCount = async (filters = {}) => {
    try {
        return await Order.countDocuments(buildQuery(filters));
    } catch (error) {
        throw error;
    }
};

export const deleteOrder = async (id) => {
    try {
        return await Order.findOneAndUpdate(
            { _id: id, deletedAt: null },
            { $set: { deletedAt: new Date(), status: 'inactive' } },
            { returnDocument: 'before' }
        ).lean();
    } catch (error) {
        throw error;
    }
};
