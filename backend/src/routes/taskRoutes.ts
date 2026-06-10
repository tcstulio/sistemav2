import { Router } from 'express';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';
import { taskRunnerService } from '../services/taskRunnerService';
import { createLogger } from '../utils/logger';

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

// Escrita: somente admin (#307). Acoes destrutivas (start, merge, kill, delete) e
// mutacoes de estado exigem isAdmin=true (verificado via Dolibarr).
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

router.post('/:issueNumber/merge', requireDolibarrAdmin, async (req, res) => {
    try {
        const task = await taskRunnerService.mergeTask(Number(req.params.issueNumber));
        res.json(task);
    } catch (error: any) {
        log.error('Merge task error', { error: error.message });
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

export default router;
