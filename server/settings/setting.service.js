import Setting from './setting.model.js';

// GST charged on top of the course amount at the store owner's cart checkout.
// The super admin changes it on the Edit User page; until then it is 18%.
const GST_KEY = 'gst_percent';
export const DEFAULT_GST_PERCENT = 18;
export const MAX_GST_PERCENT = 100;

/** A valid GST percent (0–100, at most 2 decimals), or null. */
export function parseGstPercent(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > MAX_GST_PERCENT) return null;
    return Math.round(n * 100) / 100;
}

/** The current GST percent (e.g. 18). */
export async function getGstPercent() {
    const doc = await Setting.findOne({ key: GST_KEY }).select('value').lean();
    const stored = parseGstPercent(doc?.value);
    return stored ?? DEFAULT_GST_PERCENT;
}

/**
 * Saves the GST percent. The caller validates it with parseGstPercent first.
 * @param {number} percent
 * @param {string|null} userId the super admin who changed it
 * @returns {Promise<number>} the saved percent
 */
export async function setGstPercent(percent, userId = null) {
    await Setting.findOneAndUpdate(
        { key: GST_KEY },
        { $set: { value: percent, updatedBy: userId } },
        { upsert: true, runValidators: true },
    );
    return percent;
}
