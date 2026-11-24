import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import * as OrganizationHelper from './organization.service.js';
import { requester, STORE_OWNER } from '../middleware/accountAccess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const Router = express.Router();

// ── Multer configuration ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'organizations');
        import('fs').then(({ default: fs }) => {
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        });
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.fieldname === 'org_logo' && !file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image files are allowed for organization logo.'));
    }
    cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const orgUpload = upload.fields([{ name: 'org_logo', maxCount: 1 }]);

// Parse FormData body and attach uploaded file paths
const parseBodyWithFiles = (req) => {
    const body = { ...(req.body || {}) };
    if (typeof body.course_ids === 'string') {
        try { body.course_ids = JSON.parse(body.course_ids); } catch { body.course_ids = []; }
    }
    if (typeof body.industryTypeIds === 'string') {
        try { body.industryTypeIds = JSON.parse(body.industryTypeIds); } catch { body.industryTypeIds = []; }
    }
    if (req.files?.org_logo?.[0]) {
        body.org_logo = `/uploads/organizations/${req.files.org_logo[0].filename}`;
    }
    return body;
};

// A store owner may only see and change their own organization (other organizations'
// details include their owners' contact details). Returns the owner's organization id,
// or null for a super admin.
const NO_ORG = '000000000000000000000000';
const ownOrgIdOf = async (req) => {
    const me = await requester(req);
    if (me?.user_type !== STORE_OWNER) return null;
    if (me.orgId) return String(me.orgId);
    // An owner whose account doesn't carry orgId yet: the organization they own.
    const owned = await OrganizationHelper.findOwnedOrganizationId(me._id);
    return owned ? String(owned) : NO_ORG;
};
const notFound = (res) => res.status(404).json({ status: 404, message: "Organization not found." });

// Fields only a super admin may change.
const ADMIN_ONLY_FIELDS = ['ownerId', 'status'];

const checkOrganizationName = async (req, res, next) => {
    try {
        const { name, excludeId } = req.query;
        const data = await OrganizationHelper.checkOrganizationName(name, excludeId || null);
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

const createOrganization = async (req, res, next) => {
    orgUpload(req, res, async (err) => {
        if (err) return next(err);
        try {
            const data = await OrganizationHelper.createOrganization(parseBodyWithFiles(req));
            res.status(200).json({ status: 200, message: "Successfully added.", data });
        } catch (error) {
            next(error);
        }
    });
};

const editOrganization = async (req, res, next) => {
    try {
        const ownOrgId = await ownOrgIdOf(req);
        if (ownOrgId && ownOrgId !== String(req.params.id)) return notFound(res);
        const data = await OrganizationHelper.editOrganization(req.params.id);
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

const updateOrganization = async (req, res, next) => {
    orgUpload(req, res, async (err) => {
        if (err) return next(err);
        try {
            const ownOrgId = await ownOrgIdOf(req);
            if (ownOrgId && ownOrgId !== String(req.params.id)) return notFound(res);
            const body = parseBodyWithFiles(req);
            if (ownOrgId) ADMIN_ONLY_FIELDS.forEach(field => delete body[field]);
            const data = await OrganizationHelper.updateOrganization(req.params.id, body);
            res.status(200).json({ status: 200, message: "Successfully updated.", data });
        } catch (error) {
            next(error);
        }
    });
};

const listOrganization = async (req, res, next) => {
    try {
        const { status, ownerId, search } = req.query;
        const id = await ownOrgIdOf(req);
        const data = await OrganizationHelper.listOrganization({ status, ownerId, search, id });
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

const listOrganizationPagination = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const { status, ownerId, search } = req.query;
        const filters = { status, ownerId, search, id: await ownOrgIdOf(req) };

        const [organizations, total] = await Promise.all([
            OrganizationHelper.listOrganizationPagination(page, limit, filters),
            OrganizationHelper.getOrganizationCount(filters)
        ]);
        res.status(200).json({
            status: 200,
            message: "Successfully fetched.",
            data: organizations,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        next(error);
    }
};

// GET /organization/options — id + name of the organizations, for filters and pickers
// (the full list carries logos, addresses and owner details these pages don't need).
const listOrganizationOptions = async (req, res, next) => {
    try {
        const id = await ownOrgIdOf(req);
        const data = await OrganizationHelper.listOrganizationOptions({ status: req.query.status, id });
        res.status(200).json({ status: 200, message: "Successfully fetched.", data });
    } catch (error) {
        next(error);
    }
};

const deleteOrganization = async (req, res, next) => {
    try {
        const data = await OrganizationHelper.deleteOrganization(req.params.id);
        res.status(200).json({ status: 200, message: "Successfully deleted.", data });
    } catch (error) {
        next(error);
    }
};

Router.get('/check', checkOrganizationName);
Router.post('/create', createOrganization);
Router.get('/list', listOrganization);
Router.get('/list-pagination', listOrganizationPagination);
Router.get('/options', listOrganizationOptions);
Router.get('/edit/:id', editOrganization);
Router.put('/update/:id', updateOrganization);
Router.get('/delete/:id', deleteOrganization);
Router.get('/:id', editOrganization);

export default Router;
