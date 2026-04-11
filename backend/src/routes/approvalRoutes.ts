/**
 * Approval Routes
 * 
 * Endpoints para gerenciar aprovações de automações bancárias
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { approvalService, ActionType, ActionStatus } from '../services/approvalService';
import { requireDolibarrLogin, requireDolibarrAdmin } from '../middleware/authMiddleware';

const router = Router();

// Proteger todas as rotas de aprovação (leitura requer login, escrita requer admin)
router.get('/*', requireDolibarrLogin);
router.post('/', requireDolibarrLogin);

// ===== Schemas de Validação =====

const CreateActionSchema = z.object({
    type: z.enum(['pagar_boleto', 'enviar_pix', 'baixar_fatura', 'enviar_documento']),
    banco: z.enum(['inter', 'itau']).optional(),
    payload: z.any(),
    description: z.string().min(1),
});

const RejectActionSchema = z.object({
    reason: z.string().optional(),
});

// ===== Endpoints =====

/**
 * GET /api/approvals/pending
 * Lista ações pendentes de aprovação
 */
router.get('/pending', async (req: Request, res: Response) => {
    try {
        const { type, banco } = req.query;

        const actions = await approvalService.getPendingActions({
            type: type as ActionType,
            banco: banco as 'inter' | 'itau',
        });

        res.json({
            success: true,
            count: actions.length,
            actions,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/approvals/history
 * Lista histórico de ações (aprovadas, rejeitadas, executadas)
 */
router.get('/history', async (req: Request, res: Response) => {
    try {
        const { type, status, startDate, endDate, limit } = req.query;

        const history = await approvalService.getActionHistory({
            type: type as ActionType,
            status: status as ActionStatus,
            startDate: startDate ? new Date(startDate as string) : undefined,
            endDate: endDate ? new Date(endDate as string) : undefined,
            limit: limit ? parseInt(limit as string) : 100,
        });

        res.json({
            success: true,
            count: history.length,
            history,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/approvals/stats
 * Estatísticas de aprovação
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const stats = await approvalService.getStats();
        res.json({ success: true, stats });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/approvals/:id
 * Detalhes de uma ação específica
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const action = await approvalService.getActionById(id);

        if (!action) {
            return res.status(404).json({ success: false, error: 'Ação não encontrada' });
        }

        res.json({ success: true, action });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/approvals
 * Cria uma nova ação pendente
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const data = CreateActionSchema.parse(req.body);
        const user = (req as any).user;

        const action = await approvalService.createPendingAction({
            type: data.type,
            banco: data.banco,
            payload: data.payload,
            description: data.description,
            requestedBy: user?.login || user?.id || 'unknown',
        });

        res.status(201).json({
            success: true,
            message: 'Ação criada e aguardando aprovação',
            action,
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: 'Dados inválidos',
                details: error.issues
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/approvals/:id/approve
 * Aprova uma ação e executa automaticamente
 */
router.post('/:id/approve', requireDolibarrAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = (req as any).user;

        const result = await approvalService.approveAction(
            id,
            user?.login || user?.id || 'unknown'
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json({
            success: true,
            message: 'Ação aprovada e executada com sucesso',
            result: result.result,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/approvals/:id/reject
 * Rejeita uma ação
 */
router.post('/:id/reject', requireDolibarrAdmin, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { reason } = RejectActionSchema.parse(req.body);
        const user = (req as any).user;

        const result = await approvalService.rejectAction(
            id,
            user?.login || user?.id || 'unknown',
            reason
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json({
            success: true,
            message: 'Ação rejeitada',
        });
    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: 'Dados inválidos',
                details: error.issues
            });
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
