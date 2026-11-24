'use client';

// Add / Edit Organization Course → Payment page hand-off: what is being bought, kept in
// sessionStorage (this tab only) until the payment is submitted. The server prices the
// order itself; the prices here are only for showing the summary.

export const PAYMENT_PATH = '/superadmin/organization-course-assignment/payment';
const KEY = 'orgCoursePurchaseDraft';

/**
 * @typedef {{
 *   orgId: string, orgName: string,
 *   items: Array<{ courseId: string, title: string, unitPrice: number, learners: number }>,
 *   removeIds?: string[],      // Edit page: organization-course records to remove after paying
 *   returnPath: string,        // where "Back" goes (the Add / Edit page)
 *   donePath: string,          // where to go once the courses are assigned
 * }} PurchaseDraft
 */

/** @param {PurchaseDraft} draft */
export function savePurchaseDraft(draft) {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(draft)); return true; } catch { return false; }
}

/** @returns {PurchaseDraft | null} */
export function readPurchaseDraft() {
  try {
    const draft = JSON.parse(window.sessionStorage.getItem(KEY) || 'null');
    return draft?.orgId && Array.isArray(draft.items) && draft.items.length ? draft : null;
  } catch { return null; }
}

export function clearPurchaseDraft() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
