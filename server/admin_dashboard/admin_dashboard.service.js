import User from '../users/user.model.js';
import OrganizationCourse from '../organization_course/organization_course.model.js';
import Order from '../orders/order.model.js';
import { getCourseCount } from '../courses/course.service.js';
import { getOrganizationCount, listOrganizationPagination } from '../organizations/organization.service.js';
import { getOrderCount } from '../orders/order.service.js';
import { getInvoiceCount } from '../invoices/invoice.service.js';
import { getCreditCount } from '../credits/credit.service.js';
import { getCourseCategoryCount } from '../course_category/course_category.service.js';
import { getCertificateTemplateCount } from '../certificate_template/certificate_template.service.js';
import { getTagCount } from '../tags/tag.service.js';
import { getIndustryTypeCount } from '../industry_type/industry_type.service.js';
import { getRoleCount } from '../roles/role.service.js';

// The super admin dashboard in one request. The page used to make about twenty calls,
// several of which downloaded up to 500–1000 users or orders only to count them in the
// browser; every number here is counted or summed by the database instead.

const OVERVIEW_ORGS = 10;     // newest organizations shown in the overview table
const RECENT_ORDERS = 5;

const countUsers = (query) => User.countDocuments({ deletedAt: null, ...query });

const kpiCounts = async () => {
  const entries = await Promise.all(Object.entries({
    courses:      () => getCourseCount({}),
    orgs:         () => getOrganizationCount({}),
    employees:    () => countUsers({ user_type: 'employee' }),
    orders:       () => getOrderCount({}),
    invoices:     () => getInvoiceCount({}),
    credits:      () => getCreditCount({}),
    categories:   () => getCourseCategoryCount({}),
    certs:        () => getCertificateTemplateCount({}),
    tags:         () => getTagCount({}),
    users:        () => countUsers({ user_type: 'superadmin' }),
    orgAdmins:    () => countUsers({ user_type: 'organization', orgRole: 'admin' }),
    learners:     () => countUsers({ user_type: 'employee', orgRole: 'employee' }),
    industryType: () => getIndustryTypeCount({}),
    roles:        () => getRoleCount({}),
  }).map(async ([key, count]) => [key, await count().catch(() => null)]));
  return Object.fromEntries(entries);
};

const toMap = (rows) => new Map(rows.map(r => [String(r._id), r.value]));

const groupCount = (Model, match, field) => Model.aggregate([
  { $match: match },
  { $group: { _id: `$${field}`, value: { $sum: 1 } } },
]).then(toMap);

/** Newest organizations with their admins, learners, courses and order total. */
const overviewRows = async () => {
  const orgs = await listOrganizationPagination(1, OVERVIEW_ORGS, {});
  if (!orgs.length) return [];
  const ids = orgs.map(o => o._id);
  const [admins, learners, courses, amounts] = await Promise.all([
    groupCount(User, { orgId: { $in: ids }, deletedAt: null, user_type: 'organization', orgRole: 'admin' }, 'orgId'),
    groupCount(User, { orgId: { $in: ids }, deletedAt: null, user_type: 'employee', orgRole: 'employee' }, 'orgId'),
    groupCount(OrganizationCourse, { orgId: { $in: ids }, deletedAt: null }, 'orgId'),
    Order.aggregate([
      { $match: { organizer_id: { $in: ids }, deletedAt: null, credit_amount: { $gt: 0 } } },
      { $group: { _id: '$organizer_id', value: { $sum: '$credit_amount' } } },
    ]).then(toMap),
  ]);
  return orgs.map(org => {
    const id = String(org._id);
    return {
      ...org,
      _adminCount: admins.get(id) ?? 0,
      _learnerCount: learners.get(id) ?? 0,
      _courseCount: courses.get(id) ?? 0,
      _orderAmount: amounts.get(id) ?? 0,
    };
  });
};

const ordersOverview = async () => {
  const [totals, recent] = await Promise.all([
    Order.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: null, revenue: { $sum: '$credit_amount' } } },
    ]),
    Order.find({ deletedAt: null })
      .select('_id organizer_id credit_amount status createdAt')
      .populate('organizer_id', '_id org_name')
      .sort({ createdAt: -1 })
      .limit(RECENT_ORDERS)
      .lean(),
  ]);
  return { revenue: totals[0]?.revenue ?? 0, recentOrders: recent };
};

export const getAdminDashboardSummary = async () => {
  const [counts, orgRows, orders] = await Promise.all([kpiCounts(), overviewRows(), ordersOverview()]);
  return { counts, orgRows, ...orders };
};
