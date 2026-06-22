import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireDolibarrLogin } from '../middleware/authMiddleware';
import { simulatorStore } from '../services/simulatorStore';
import { createLogger } from '../utils/logger';

const log = createLogger('SimulatorRoutes');
const router = Router();

// All simulator routes require login
router.use(requireDolibarrLogin);

// --- Zod schemas ---

const SummarySchema = z.object({
    revenue: z.number(),
    profit: z.number(),
    modelLabel: z.string()
});

const CreateSnapshotSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    date: z.number().int().positive(),
    data: z.unknown(),
    summary: SummarySchema
});

const UpdateSnapshotSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    date: z.number().int().positive().optional(),
    data: z.unknown().optional(),
    summary: SummarySchema.optional()
}).refine(
    obj => obj.name !== undefined || obj.date !== undefined || obj.data !== undefined || obj.summary !== undefined,
    { message: 'At least one field must be provided for update' }
);

// --- Routes ---

// GET /api/simulator/simulations
router.get('/simulations', (req: Request, res: Response) => {
    try {
        const simulations = simulatorStore.list();
        res.status(200).json(simulations);
    } catch (error: any) {
        log.error('Failed to list simulations', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/simulator/simulations
router.post('/simulations', (req: Request, res: Response) => {
    let body;
    try {
        body = CreateSnapshotSchema.parse(req.body);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        return res.status(500).json({ error: error.message });
    }

    try {
        const created = simulatorStore.create(body);
        return res.status(201).json(created);
    } catch (err: any) {
        log.error('Failed to create simulation', { error: err.message });
        return res.status(500).json({ error: 'Failed to save simulation', details: err.message });
    }
});

// PUT /api/simulator/simulations/:id
router.put('/simulations/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    let body;
    try {
        body = UpdateSnapshotSchema.parse(req.body);
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: 'Validation Error', details: error.issues });
        }
        return res.status(500).json({ error: error.message });
    }

    try {
        const updated = simulatorStore.update(id, body);
        if (!updated) {
            return res.status(404).json({ error: 'Simulation not found' });
        }
        return res.status(200).json(updated);
    } catch (err: any) {
        log.error('Failed to update simulation', { id, error: err.message });
        return res.status(500).json({ error: 'Failed to update simulation', details: err.message });
    }
});

// DELETE /api/simulator/simulations/:id
router.delete('/simulations/:id', (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const deleted = simulatorStore.delete(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Simulation not found' });
        }
        return res.status(204).send();
    } catch (err: any) {
        log.error('Failed to delete simulation', { id, error: err.message });
        return res.status(500).json({ error: 'Failed to delete simulation', details: err.message });
    }
});

export default router;
