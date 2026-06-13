import { Router } from 'express';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { taskRunnerService } from '../services/taskRunnerService';
import { screenshotService } from '../services/screenshotService';
import { createLogger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

const log = createLogger('TaskRunner');
const router = Router();

// Leitura: qualquer usuario logado.
router.get('/', requireDolibarrLogin, async (req, res) => {
    try {
        // Reconcilia com GitHub antes de devolver (idempotente, resolve tasks orfas).
        await taskRunnerService.syncWithGitHub();
        const tasks = await taskRunnerService.syncTasks();
        res.json(tasks);
    } catch (error: any) {
        log.error('List tasks error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/:issueNumber', requireDolibarrLogin, async (req, res) => {
    try {
        const task = taskRunnerService.getTask(Number(req.params.issueNumber));
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (error: any) {
        log.error('Get task error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/:issueNumber/diff', requireDolibarrLogin, async (req, res) => {
    try {
        const diff = await taskRunnerService.getDiff(Number(req.params.issueNumber));
        res.json({ diff });
    } catch (error: any) {
        log.error('Get diff error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Timeline persistida (#306). Retorna eventos ordenados por timestamp.
router.get('/:issueNumber/events', requireDolibarrLogin, async (req, res) => {
    try {
        const task = taskRunnerService.getTask(Number(req.params.issueNumber));
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const events = (task.events || []).slice().sort((a, b) => a.ts.localeCompare(b.ts));
        res.json({ events });
    } catch (error: any) {
        log.error('Get events error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.get('/:issueNumber/screenshots', requireDolibarrLogin, async (req, res) => {
    try {
        const issueNumber = Number(req.params.issueNumber);
        const beforePath = screenshotService.getScreenshotPath(issueNumber, 'before');
        const afterPath = screenshotService.getScreenshotPath(issueNumber, 'after');
        res.json({
            before: fs.existsSync(beforePath) ? `/api/tasks/${issueNumber}/screenshots/before` : null,
            after: fs.existsSync(afterPath) ? `/api/tasks/${issueNumber}/screenshots/after` : null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/:issueNumber/screenshots/:type', requireDolibarrLogin, async (req, res) => {
    try {
        const issueNumber = Number(req.params.issueNumber);
        const type = req.params.type as 'before' | 'after';
        if (type !== 'before' && type !== 'after') return res.status(400).json({ error: 'Invalid type' });
        const filePath = screenshotService.getScreenshotPath(issueNumber, type);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Screenshot not found' });
        res.setHeader('Content-Type', 'image/png');
        fs.createReadStream(filePath).pipe(res);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Escrita: somente admin (#307). Acoes destrutivas (start, merge, kill, delete) e
// mutacoes de estado exigem isAdmin=true (verificado via Dolibarr).
// Fila e planejamento (#331)
router.post('/plan', requireDolibarrAdmin, async (req, res) => {
    try {
        const result = await taskRunnerService.planWithLLM();
        res.json(result);
    } catch (error: any) {
        log.error('Plan tasks error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.put('/reorder', requireDolibarrAdmin, async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of issue numbers' });
        taskRunnerService.reorderTasks(order);
        res.json({ ok: true });
    } catch (error: any) {
        log.error('Reorder tasks error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/', requireDolibarrAdmin, async (req, res) => {
    try {
        const { title, body, labels } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required' });
        const task = await taskRunnerService.createTask(title, body || '', labels);
        res.json(task);
    } catch (error: any) {
        log.error('Create task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/start', requireDolibarrAdmin, async (req, res) => {
    try {
        const issueNumber = Number(req.params.issueNumber);
        if (!taskRunnerService.getTask(issueNumber)) {
            return res.status(404).json({ error: 'Task not found. Sync first.' });
        }
        const task = await taskRunnerService.startTask(issueNumber);
        res.json(task);
    } catch (error: any) {
        log.error('Start task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/fix', requireDolibarrAdmin, async (req, res) => {
    try {
        const { feedback } = req.body;
        if (!feedback) return res.status(400).json({ error: 'Feedback is required' });
        const task = await taskRunnerService.addFeedback(Number(req.params.issueNumber), feedback);
        res.json(task);
    } catch (error: any) {
        log.error('Fix task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/redo', requireDolibarrAdmin, async (req, res) => {
    try {
        const { instruction } = req.body;
        const task = await taskRunnerService.redoTask(Number(req.params.issueNumber), instruction);
        res.json(task);
    } catch (error: any) {
        log.error('Redo task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/reject', requireDolibarrAdmin, async (req, res) => {
    try {
        const task = await taskRunnerService.rejectTask(Number(req.params.issueNumber));
        res.json(task);
    } catch (error: any) {
        log.error('Reject task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

// Epic routes
router.post('/:issueNumber/mark-epic', requireDolibarrAdmin, async (req, res) => {
    try {
        const task = await taskRunnerService.markAsEpic(Number(req.params.issueNumber));
        res.json(task);
    } catch (error: any) {
        log.error('Mark epic error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/decompose', requireDolibarrAdmin, async (req, res) => {
    try {
        const task = await taskRunnerService.decomposeEpic(Number(req.params.issueNumber));
        res.json(task);
    } catch (error: any) {
        log.error('Decompose epic error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/approve-decomposition', requireDolibarrAdmin, async (req, res) => {
    try {
        const task = await taskRunnerService.approveDecomposition(Number(req.params.issueNumber));
        res.json(task);
    } catch (error: any) {
        log.error('Approve decomposition error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/:issueNumber/merge', requireDolibarrAdmin, async (req, res) => {
    try {
        // Admin verificado server-side aprovando manualmente: override humano do piso de score.
        const task = await taskRunnerService.mergeTask(Number(req.params.issueNumber), { force: true });
        res.json(task);
    } catch (error: any) {
        log.error('Merge task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

// Kill/cancel (issue #304). Admin only. Seta killRequested no service que mata
// o processo do opencode (e filhos) e marca status como cancelled.
router.post('/:issueNumber/kill', requireDolibarrAdmin, async (req, res) => {
    try {
        const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason : 'admin request';
        const task = await taskRunnerService.killTask(Number(req.params.issueNumber), reason);
        res.json(task);
    } catch (error: any) {
        log.error('Kill task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.put('/:issueNumber', requireDolibarrAdmin, async (req, res) => {
    try {
        const { title, body, labels } = req.body;
        const task = await taskRunnerService.updateTask(Number(req.params.issueNumber), { title, body, labels });
        res.json(task);
    } catch (error: any) {
        log.error('Update task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.delete('/:issueNumber', requireDolibarrAdmin, async (req, res) => {
    try {
        await taskRunnerService.deleteTask(Number(req.params.issueNumber));
        res.json({ ok: true });
    } catch (error: any) {
        log.error('Delete task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.post('/planner/analyze/:issueNumber', requireDolibarrAdmin, async (req, res) => {
    try {
        const { taskPlannerService } = require('../services/taskPlannerService');
        const task = taskRunnerService.getTask(Number(req.params.issueNumber));
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const decision = await taskPlannerService.analyzeTask(task);
        res.json(decision);
    } catch (error: any) {
        log.error('Planner analyze error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.post('/planner/reevaluate', requireDolibarrAdmin, async (req, res) => {
    try {
        const { taskPlannerService } = require('../services/taskPlannerService');
        const results = await taskPlannerService.reevaluateWaiting();
        res.json({ reevaluated: results.length, decisions: results });
    } catch (error: any) {
        log.error('Planner reevaluate error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

router.post('/:issueNumber/preview', requireDolibarrAdmin, async (req, res) => {
    try {
        const preview = await taskRunnerService.startPreview(Number(req.params.issueNumber));
        res.json(preview);
    } catch (error: any) {
        log.error('Preview task error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

router.delete('/:issueNumber/preview', requireDolibarrAdmin, async (req, res) => {
    try {
        await taskRunnerService.stopPreview(Number(req.params.issueNumber));
        res.json({ ok: true });
    } catch (error: any) {
        log.error('Stop preview error', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

export default router;
