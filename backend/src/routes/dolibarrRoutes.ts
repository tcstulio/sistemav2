import { Router } from 'express';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { dolibarrService } from '../services/dolibarrService';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger';

const log = createLogger('Dolibarr');
const router = Router();

// Basic Rate Limiter: 5000 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});

router.use(limiter);
router.use(requireDolibarrLogin);


// --- Zod Schemas for Validation ---
// We define simplified schemas to validate incoming payloads before sending to Dolibarr
// This prevents malformed requests from even reaching the service

const ThirdPartySchema = z.object({
    name: z.string().min(1),
    code_client: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    client: z.enum(['1', '2', '3']).optional(), // 1=Customer, 2=Prospect, 3=Both
    fournisseur: z.enum(['0', '1']).optional(), // 0=No, 1=Yes
});

const InvoiceSchema = z.object({
    socid: z.string().min(1), // ThirdParty ID is required
    date: z.number().or(z.string()), // Timestamp or Date string
    type: z.number().default(0), // 0=Standard
    lines: z.array(z.object({
        desc: z.string().optional(),
        subprice: z.number(),
        qty: z.number().min(1),
        tva_tx: z.number().optional(),
        fk_product: z.number().optional()
    })).min(1)
});

// Middleware helper for validation
const validate = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
    try {
        schema.parse(req.body);
        next();
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: (error as z.ZodError).issues });
        }
        return res.status(400).json({ error: 'Invalid Request' });
    }
};

// --- Controller Methods for Strict Typed Actions ---

// Helper to extract key from Header OR Query
const getApiKey = (req: any): string | undefined => {
    const headerKey = req.headers['dolapikey'];
    if (headerKey) return headerKey as string;

    const queryKey = req.query.DOLAPIKEY;
    if (queryKey) return queryKey as string;

    return undefined;
};

// Create Third Party
router.post('/thirdparties', validate(ThirdPartySchema), async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.createThirdParty(req.body, userKey);
        res.json(result);
    } catch (error: any) {
        // Error is now normalized by Service
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Create Invoice
router.post('/invoices', validate(InvoiceSchema), async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.createInvoice(req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Add Payment
router.post('/invoices/:id/payments', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.addPayment(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Validate Supplier Order
router.post('/supplierorders/:id/validate', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.validateSupplierOrder(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Close Proposal
router.post('/proposals/:id/close', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.closeProposal(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});

// Add Time Spent
router.post('/tasks/:id/addtimespent', async (req, res) => {
    try {
        const userKey = getApiKey(req);
        const result = await dolibarrService.addTimeSpent(req.params.id, req.body, userKey);
        res.json(result);
    } catch (error: any) {
        const status = error.status || 500;
        res.status(status).json({ error: error.message, details: error.details });
    }
});


// --- Delta Sync Custom Endpoint ---
// Routes to custom_sync.php at Dolibarr root (not /api/index.php)
router.get('/custom_sync.php', async (req, res) => {
    try {
        const response = await dolibarrService.proxyCustomSync(req.query, req.headers);
        res.status(response.status).json(response.data);
    } catch (error: any) {
        log.error('CustomSync Proxy Error', { error: error.message });
        const status = error.status || 500;
        res.status(status).json({ error: error.message || 'Custom Sync Error' });
    }
});

// --- Wildcard Proxy for Everything Else (Reads & Untyped Writes) ---
// Forwards all requests from /api/dolibarr/* to the actual Dolibarr URL
router.all('/*', async (req, res) => {
    try {
        // req.path will be something like "/thirdparties/123" or "/invoices"
        // Note: The specific routes above will be matched FIRST by Express if they match exactly.
        // However, "all /*" matches everything. We need to ensure specific routes are defined BEFORE this wildcard.
        // Express executes in order. So the above definitions capture the specific POSTs.
        // For existing GETs or other POSTs not defined above, this wildcard catches them.

        const response = await dolibarrService.proxyRequest(
            req.method,
            req.path,
            req.body,
            req.query,
            req.headers
        );

        res.status(response.status).json(response.data);

    } catch (error: any) {
        log.error('Proxy Error', { error: error.message });
        const status = error.status || 500;
        res.status(status).json({ error: error.message || 'Internal Proxy Error', details: error.details });
    }
});

export default router;
