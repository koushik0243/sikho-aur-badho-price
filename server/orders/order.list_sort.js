// Server-side sorting for the super admin Orders and Invoices lists (list-pagination).
//
// The lists used to download every record and sort in the browser; these aggregation pieces
// reproduce that browser ordering so paging can move to the server without changing what the
// user sees. Each sortable column maps to a sort key expression; the lists compare
// lowercased strings / numbers / dates, and ties keep the old server order (newest created
// first), which is what the browser's stable sort did.
import Organization from '../organizations/organization.model.js';
import Credit from '../credits/credit.model.js';

// Helper fields added while sorting; removed again before the page is returned.
const SORT_KEY = '_sort_key';
const HELPER_FIELDS = [SORT_KEY, '_sort_org', '_sort_credit', '_sort_item'];

// Ties: newest created first (the order the browser received rows in), then _id so paging
// is deterministic even when createdAt is equal.
const TIE_BREAK = { createdAt: -1, _id: -1 };

// time(v) in the browser treated a missing date as 0 (epoch), so do the same here.
const EPOCH = new Date(0);

const DEFAULT_PAGE_LIMIT = 10;
// One page never asks the database for more than this many rows.
const MAX_PAGE_LIMIT = 100;

export const sortDirection = (dir) => (dir === 'desc' ? -1 : 1);

/**
 * ?page&limit&sort&dir of a list-pagination request, clamped to sane values. `sort` is only
 * passed through as a string; each service whitelists the keys it supports.
 */
export function pageParams(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_LIMIT));
    const sort = typeof query.sort === 'string' ? query.sort : undefined;
    const dir = query.dir === 'desc' ? 'desc' : 'asc';
    return { page, limit, sort, dir };
}

/** String(v || '').toLowerCase() — missing/null become ''. */
export const lowerOrEmpty = (expr) => ({ $toLower: { $ifNull: [expr, ''] } });

/** Number(v) || 0 for a stored number. */
export const numberOrZero = (expr) => ({ $ifNull: [expr, 0] });

/** time(v): a missing date sorts as the epoch. */
export const dateOrEpoch = (expr) => ({ $ifNull: [expr, EPOCH] });

// JS `value || fallback` for a string: null, missing and '' all fall back.
const stringOr = (expr, fallback) => ({
    $cond: [{ $eq: [{ $ifNull: [expr, ''] }, ''] }, fallback, expr],
});

/**
 * Pulls one field of a referenced document into `as` (a scalar, missing if there is no
 * such document) — the aggregation equivalent of populate(localField).field.
 */
export function lookupField({ from, localField, field, as }) {
    return [
        {
            $lookup: {
                from,
                localField,
                foreignField: '_id',
                pipeline: [{ $project: { _id: 0, v: `$${field}` } }],
                as,
            },
        },
        { $set: { [as]: { $first: `$${as}.v` } } },
    ];
}

/**
 * Stages run on order documents that set `_sort_item` to the order's "Purchased Item" label,
 * mirroring client/src/lib/orderDisplay.js orderItemLabel():
 *   credit order  → the credit package title, or '—'
 *   course order  → the single course's title (or '1 course'), else "N courses"
 */
export function orderItemLabelStages() {
    const items = { $cond: [{ $isArray: '$items' }, '$items', []] };
    const courseLabel = {
        $let: {
            vars: { items },
            in: {
                $cond: [
                    { $eq: [{ $size: '$$items' }, 1] },
                    stringOr({ $getField: { field: 'title', input: { $first: '$$items' } } }, '1 course'),
                    { $concat: [{ $toString: { $size: '$$items' } }, ' courses'] },
                ],
            },
        },
    };
    return [
        ...lookupField({ from: Credit.collection.name, localField: 'credit_id', field: 'title', as: '_sort_credit' }),
        {
            $set: {
                _sort_item: {
                    $cond: [{ $eq: ['$order_type', 'course'] }, courseLabel, stringOr('$_sort_credit', '—')],
                },
            },
        },
    ];
}

/** The organization's name (lowercased) via `localField` → organizations.org_name. */
export function orgNameSort(localField) {
    return {
        stages: lookupField({ from: Organization.collection.name, localField, field: 'org_name', as: '_sort_org' }),
        key: lowerOrEmpty('$_sort_org'),
    };
}

/**
 * Aggregation stages for one page of a list sorted by `spec`:
 *   { stages?, key }  a clicked column, sorted by `dir`
 *   { key, dir }      a list's default order with a fixed direction
 *   { sort }          a default order on plain fields (can use an index)
 */
export function sortedPageStages(spec, dir, page, limit) {
    const sortStages = spec.sort
        ? [{ $sort: { ...spec.sort, ...TIE_BREAK } }]
        : [
            ...(spec.stages || []),
            { $set: { [SORT_KEY]: spec.key } },
            { $sort: { [SORT_KEY]: sortDirection(spec.dir || dir), ...TIE_BREAK } },
        ];
    return [
        ...sortStages,
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $unset: HELPER_FIELDS },
    ];
}
