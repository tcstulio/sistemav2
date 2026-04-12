import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEmit = vi.fn();
vi.mock('../../services/socketService', () => ({
    socketService: { emit: mockEmit },
}));

const mockPagarBoleto = vi.fn();
const mockEnviarPix = vi.fn();
const mockGetSaldo = vi.fn();
vi.mock('../../services/interApiService', () => ({
    interApiService: {
        pagarBoleto: mockPagarBoleto,
        enviarPix: mockEnviarPix,
        getSaldo: mockGetSaldo,
    },
}));

const mockItauPagarBoleto = vi.fn();
const mockItauEnviarPix = vi.fn();
const mockItauGetSaldo = vi.fn();
vi.mock('../../services/itauApiService', () => ({
    itauApiService: {
        pagarBoleto: mockItauPagarBoleto,
        enviarPix: mockItauEnviarPix,
        getSaldo: mockItauGetSaldo,
    },
}));

const mockSendFile = vi.fn();
const mockSendText = vi.fn();
vi.mock('../../services/legacy/messageService', () => ({
    messageService: {
        sendFile: mockSendFile,
        sendText: mockSendText,
    },
}));

vi.mock('../../services/dolibarrService', () => ({
    dolibarrService: {},
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
    v4: () => `uuid-${++uuidCounter}`,
}));

describe('approvalService', () => {
    let approvalService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        uuidCounter = 0;
        vi.resetModules();
        const mod = await import('../../services/approvalService');
        approvalService = mod.approvalService;
    });

    describe('createPendingAction', () => {
        it('creates action with correct defaults', async () => {
            const action = await approvalService.createPendingAction({
                type: 'pagar_boleto',
                banco: 'inter',
                payload: { barCode: '123' },
                description: 'Pay water bill',
                requestedBy: 'user1',
            });

            expect(action.id).toBe('uuid-1');
            expect(action.type).toBe('pagar_boleto');
            expect(action.banco).toBe('inter');
            expect(action.payload).toEqual({ barCode: '123' });
            expect(action.description).toBe('Pay water bill');
            expect(action.riskLevel).toBe('high');
            expect(action.requestedBy).toBe('user1');
            expect(action.status).toBe('pending');
            expect(action.requestedAt).toBeInstanceOf(Date);
        });

        it('emits approval_pending event', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo',
                description: 'Check balance',
                requestedBy: 'user1',
                payload: {},
            });
            expect(mockEmit).toHaveBeenCalledWith('approval_pending', expect.objectContaining({
                action: expect.objectContaining({ type: 'consulta_saldo' }),
                message: expect.stringContaining('Check balance'),
            }));
        });

        it('assigns high risk to pagar_boleto and enviar_pix', async () => {
            const h1 = await approvalService.createPendingAction({
                type: 'pagar_boleto', description: 'd', requestedBy: 'u', payload: {},
            });
            const h2 = await approvalService.createPendingAction({
                type: 'enviar_pix', description: 'd', requestedBy: 'u', payload: {},
            });
            expect(h1.riskLevel).toBe('high');
            expect(h2.riskLevel).toBe('high');
        });

        it('assigns medium risk to baixar_fatura and aprovar_reconciliacao', async () => {
            const m1 = await approvalService.createPendingAction({
                type: 'baixar_fatura', description: 'd', requestedBy: 'u', payload: {},
            });
            const m2 = await approvalService.createPendingAction({
                type: 'aprovar_reconciliacao', description: 'd', requestedBy: 'u', payload: {},
            });
            expect(m1.riskLevel).toBe('medium');
            expect(m2.riskLevel).toBe('medium');
        });

        it('assigns low risk to enviar_documento and consulta_saldo', async () => {
            const l1 = await approvalService.createPendingAction({
                type: 'enviar_documento', description: 'd', requestedBy: 'u', payload: {},
            });
            const l2 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            expect(l1.riskLevel).toBe('low');
            expect(l2.riskLevel).toBe('low');
        });

        it('handles action without banco', async () => {
            const action = await approvalService.createPendingAction({
                type: 'enviar_documento',
                description: 'Send doc',
                requestedBy: 'user1',
                payload: {},
            });
            expect(action.banco).toBeUndefined();
        });
    });

    describe('getPendingActions', () => {
        it('returns only pending actions by default', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd1', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.getPendingActions();
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('pending');
        });

        it('filters by type', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.createPendingAction({
                type: 'enviar_pix', description: 'd2', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.getPendingActions({ type: 'enviar_pix' });
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('enviar_pix');
        });

        it('filters by banco', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'itau', description: 'd2', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.getPendingActions({ banco: 'inter' });
            expect(result).toHaveLength(1);
            expect(result[0].banco).toBe('inter');
        });

        it('filters by status', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.createPendingAction({
                type: 'enviar_pix', description: 'd2', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.getPendingActions({ status: 'pending' });
            expect(result).toHaveLength(2);
        });

        it('sorts by requestedAt descending', async () => {
            const originalNow = Date.now;
            let time = 1000;
            Date.now = () => time++;

            const RealDate = Date;
            const MockDate = class extends RealDate {
                constructor() {
                    super();
                    return new RealDate(MockDate.now());
                }
                static now() {
                    return time++;
                }
            };
            globalThis.Date = MockDate as any;

            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'first', requestedBy: 'u', payload: {},
            });
            const a2 = await approvalService.createPendingAction({
                type: 'enviar_documento', description: 'second', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.getPendingActions();
            expect(result[0].id).toBe(a2.id);
            expect(result[1].id).toBe(a1.id);

            globalThis.Date = RealDate;
        });

        it('returns empty when no matching filters', async () => {
            const result = await approvalService.getPendingActions({ type: 'enviar_pix' });
            expect(result).toHaveLength(0);
        });
    });

    describe('getActionById', () => {
        it('returns pending action by id', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            const found = await approvalService.getActionById(action.id);
            expect(found.id).toBe(action.id);
        });

        it('returns action from history', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(action.id, 'admin', 'nope');
            const found = await approvalService.getActionById(action.id);
            expect(found.status).toBe('rejected');
        });

        it('returns null for unknown id', async () => {
            const found = await approvalService.getActionById('nonexistent');
            expect(found).toBeNull();
        });
    });

    describe('approveAction', () => {
        it('returns error for non-existent action', async () => {
            const result = await approvalService.approveAction('nonexistent', 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Ação não encontrada');
        });

        it('returns error if action is not pending', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            action.status = 'approved';
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Ação já foi');
        });

        it('approves and executes consulta_saldo inter', async () => {
            mockGetSaldo.mockResolvedValue({ balance: 1000 });
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(result.result).toEqual({ balance: 1000 });
            expect(mockEmit).toHaveBeenCalledWith('approval_executed', expect.any(Object));
        });

        it('approves and executes consulta_saldo itau', async () => {
            mockItauGetSaldo.mockResolvedValue({ balance: 2000 });
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'itau', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(result.result).toEqual({ balance: 2000 });
        });

        it('approves and executes pagar_boleto inter', async () => {
            mockPagarBoleto.mockResolvedValue({ transactionId: 'tx1' });
            const action = await approvalService.createPendingAction({
                type: 'pagar_boleto', banco: 'inter', description: 'd', requestedBy: 'u',
                payload: { barCode: '123' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(mockPagarBoleto).toHaveBeenCalledWith({ barCode: '123' });
        });

        it('approves and executes pagar_boleto itau', async () => {
            mockItauPagarBoleto.mockResolvedValue({ transactionId: 'tx2' });
            const action = await approvalService.createPendingAction({
                type: 'pagar_boleto', banco: 'itau', description: 'd', requestedBy: 'u',
                payload: { barCode: '456' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(mockItauPagarBoleto).toHaveBeenCalledWith({ barCode: '456' });
        });

        it('throws when pagar_boleto has no banco', async () => {
            const action = await approvalService.createPendingAction({
                type: 'pagar_boleto', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Banco não especificado para pagamento');
        });

        it('approves and executes enviar_pix inter', async () => {
            mockEnviarPix.mockResolvedValue({ transactionId: 'pix1' });
            const action = await approvalService.createPendingAction({
                type: 'enviar_pix', banco: 'inter', description: 'd', requestedBy: 'u',
                payload: { key: '123' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(mockEnviarPix).toHaveBeenCalledWith({ key: '123' });
        });

        it('approves and executes enviar_pix itau', async () => {
            mockItauEnviarPix.mockResolvedValue({ transactionId: 'pix2' });
            const action = await approvalService.createPendingAction({
                type: 'enviar_pix', banco: 'itau', description: 'd', requestedBy: 'u',
                payload: { key: '456' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(mockItauEnviarPix).toHaveBeenCalledWith({ key: '456' });
        });

        it('throws when enviar_pix has no banco', async () => {
            const action = await approvalService.createPendingAction({
                type: 'enviar_pix', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Banco não especificado para PIX');
        });

        it('approves and executes baixar_fatura', async () => {
            const action = await approvalService.createPendingAction({
                type: 'baixar_fatura', description: 'd', requestedBy: 'u',
                payload: { invoiceId: 'inv1' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(result.result.success).toBe(true);
        });

        it('approves and executes enviar_documento', async () => {
            mockSendFile.mockResolvedValue({ ok: true });
            const action = await approvalService.createPendingAction({
                type: 'enviar_documento', description: 'd', requestedBy: 'u',
                payload: { sessionId: 's1', chatId: 'c1', fileData: 'data', filename: 'f.pdf', caption: 'doc' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(mockSendFile).toHaveBeenCalledWith('s1', 'c1', 'data', 'f.pdf', 'doc');
        });

        it('approves and executes aprovar_reconciliacao', async () => {
            const action = await approvalService.createPendingAction({
                type: 'aprovar_reconciliacao', description: 'd', requestedBy: 'u',
                payload: { lineId: 'l1', invoiceId: 'inv1', userApiKey: 'key' },
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
            expect(result.result.success).toBe(true);
        });

        it('throws when consulta_saldo has no banco', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Banco não especificado para consulta de saldo');
        });

        it('handles execution failure', async () => {
            mockGetSaldo.mockRejectedValue(new Error('API error'));
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('API error');
            expect(mockEmit).toHaveBeenCalledWith('approval_failed', expect.any(Object));
        });

        it('moves action to history after approval', async () => {
            mockGetSaldo.mockResolvedValue({});
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            await approvalService.approveAction(action.id, 'admin');
            const history = await approvalService.getActionHistory();
            expect(history).toHaveLength(1);
            expect(history[0].id).toBe(action.id);
        });

        it('throws for unknown action type in executeAction', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo' as any, description: 'd', requestedBy: 'u', payload: {},
            });
            action.type = 'unknown_type';
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Tipo de ação desconhecido: unknown_type');
        });
    });

    describe('approveAction with notifyOnComplete', () => {
        it('sends notification during execution (status is approved)', async () => {
            mockGetSaldo.mockResolvedValue({ transactionId: 'tx-123' });
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'Check balance', requestedBy: 'u', payload: {},
            });
            action.notifyOnComplete = { sessionId: 's1', chatId: 'c1' };
            await approvalService.approveAction(action.id, 'admin');
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.any(String));
        });

        it('handles notification failure gracefully', async () => {
            mockGetSaldo.mockResolvedValue({});
            mockSendText.mockRejectedValue(new Error('send failed'));
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            action.notifyOnComplete = { sessionId: 's1', chatId: 'c1' };
            const result = await approvalService.approveAction(action.id, 'admin');
            expect(result.success).toBe(true);
        });

        it('does not send notification when notifyOnComplete is not set', async () => {
            mockGetSaldo.mockResolvedValue({});
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            await approvalService.approveAction(action.id, 'admin');
            expect(mockSendText).not.toHaveBeenCalled();
        });
    });

    describe('notifyRequester private method', () => {
        it('sends executed notification message', async () => {
            const action = {
                status: 'executed',
                description: 'Pay bill',
                notifyOnComplete: { sessionId: 's1', chatId: 'c1' },
            };
            await approvalService.notifyRequester(action, { transactionId: 'tx-1' });
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.stringContaining('Aprovada e Executada'));
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.stringContaining('tx-1'));
        });

        it('sends executed notification without transactionId', async () => {
            const action = {
                status: 'executed',
                description: 'Pay bill',
                notifyOnComplete: { sessionId: 's1', chatId: 'c1' },
            };
            await approvalService.notifyRequester(action, {});
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.not.stringContaining('ID:'));
        });

        it('sends rejected notification message', async () => {
            const action = {
                status: 'rejected',
                description: 'Pay bill',
                rejectionReason: 'Too risky',
                notifyOnComplete: { sessionId: 's1', chatId: 'c1' },
            };
            await approvalService.notifyRequester(action, {});
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.stringContaining('Rejeitada'));
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.stringContaining('Too risky'));
        });

        it('sends rejected notification without reason', async () => {
            const action = {
                status: 'rejected',
                description: 'Pay bill',
                notifyOnComplete: { sessionId: 's1', chatId: 'c1' },
            };
            await approvalService.notifyRequester(action, {});
            expect(mockSendText).toHaveBeenCalledWith('s1', 'c1', expect.stringContaining('Não informado'));
        });

        it('returns early when notifyOnComplete is not set', async () => {
            await approvalService.notifyRequester({ notifyOnComplete: undefined }, {});
            expect(mockSendText).not.toHaveBeenCalled();
        });

        it('handles send failure', async () => {
            mockSendText.mockRejectedValue(new Error('fail'));
            const action = {
                status: 'executed',
                description: 'd',
                notifyOnComplete: { sessionId: 's1', chatId: 'c1' },
            };
            await approvalService.notifyRequester(action, {});
        });
    });

    describe('rejectAction', () => {
        it('returns error for non-existent action', async () => {
            const result = await approvalService.rejectAction('nonexistent', 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toBe('Ação não encontrada');
        });

        it('returns error if action is not pending', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            action.status = 'approved';
            const result = await approvalService.rejectAction(action.id, 'admin');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Ação já foi');
        });

        it('rejects a pending action with reason', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.rejectAction(action.id, 'admin', 'Too risky');
            expect(result.success).toBe(true);
            expect(mockEmit).toHaveBeenCalledWith('approval_rejected', expect.objectContaining({
                actionId: action.id,
                rejectedBy: 'admin',
                reason: 'Too risky',
            }));

            const found = await approvalService.getActionById(action.id);
            expect(found.status).toBe('rejected');
            expect(found.rejectionReason).toBe('Too risky');
            expect(found.reviewedBy).toBe('admin');
            expect(found.reviewedAt).toBeInstanceOf(Date);
        });

        it('rejects without reason', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            const result = await approvalService.rejectAction(action.id, 'admin');
            expect(result.success).toBe(true);
            const found = await approvalService.getActionById(action.id);
            expect(found.rejectionReason).toBeUndefined();
        });
    });

    describe('getActionHistory', () => {
        it('returns empty history initially', async () => {
            const history = await approvalService.getActionHistory();
            expect(history).toHaveLength(0);
        });

        it('returns history after actions are processed', async () => {
            mockGetSaldo.mockResolvedValue({});
            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.approveAction(a1.id, 'admin');

            const a2 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd2', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a2.id, 'admin', 'nope');

            const history = await approvalService.getActionHistory();
            expect(history).toHaveLength(2);
        });

        it('filters by startDate', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            action.requestedAt = new Date('2024-01-01');
            await approvalService.rejectAction(action.id, 'admin');
            const future = new Date('2025-01-01');
            const history = await approvalService.getActionHistory({ startDate: future });
            expect(history).toHaveLength(0);
        });

        it('filters by endDate', async () => {
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            action.requestedAt = new Date('2025-01-01');
            await approvalService.rejectAction(action.id, 'admin');
            const past = new Date('2024-01-01');
            const history = await approvalService.getActionHistory({ endDate: past });
            expect(history).toHaveLength(0);
        });

        it('filters by type', async () => {
            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a1.id, 'admin');
            const history = await approvalService.getActionHistory({ type: 'enviar_pix' });
            expect(history).toHaveLength(0);
        });

        it('filters by status', async () => {
            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a1.id, 'admin');
            const history = await approvalService.getActionHistory({ status: 'rejected' });
            expect(history).toHaveLength(1);
        });

        it('applies limit', async () => {
            for (let i = 0; i < 5; i++) {
                const a = await approvalService.createPendingAction({
                    type: 'consulta_saldo', description: `d${i}`, requestedBy: 'u', payload: {},
                });
                await approvalService.rejectAction(a.id, 'admin');
            }
            const history = await approvalService.getActionHistory({ limit: 3 });
            expect(history).toHaveLength(3);
        });

        it('sorts by requestedAt descending', async () => {
            let time = 1000;
            const RealDate = Date;
            const MockDate = class extends RealDate {
                constructor() {
                    super();
                    return new RealDate(MockDate.now());
                }
                static now() {
                    return time++;
                }
            };
            globalThis.Date = MockDate as any;

            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'first', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a1.id, 'admin');

            const a2 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'second', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a2.id, 'admin');

            const history = await approvalService.getActionHistory();
            expect(history[0].id).toBe(a2.id);
            expect(history[1].id).toBe(a1.id);

            globalThis.Date = RealDate;
        });
    });

    describe('getStats', () => {
        it('returns empty stats initially', async () => {
            const stats = await approvalService.getStats();
            expect(stats).toEqual({ pending: 0, approved: 0, rejected: 0, executed: 0, failed: 0 });
        });

        it('counts pending actions', async () => {
            await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd', requestedBy: 'u', payload: {},
            });
            const stats = await approvalService.getStats();
            expect(stats.pending).toBe(1);
        });

        it('counts executed and rejected actions', async () => {
            mockGetSaldo.mockResolvedValue({});
            const a1 = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd1', requestedBy: 'u', payload: {},
            });
            await approvalService.approveAction(a1.id, 'admin');

            const a2 = await approvalService.createPendingAction({
                type: 'consulta_saldo', description: 'd2', requestedBy: 'u', payload: {},
            });
            await approvalService.rejectAction(a2.id, 'admin');

            const stats = await approvalService.getStats();
            expect(stats.executed).toBe(1);
            expect(stats.rejected).toBe(1);
        });

        it('counts failed actions', async () => {
            mockGetSaldo.mockRejectedValue(new Error('fail'));
            const action = await approvalService.createPendingAction({
                type: 'consulta_saldo', banco: 'inter', description: 'd', requestedBy: 'u', payload: {},
            });
            await approvalService.approveAction(action.id, 'admin');
            const stats = await approvalService.getStats();
            expect(stats.failed).toBe(1);
        });
    });

    describe('moveToHistory', () => {
        it('trims history to 1000 entries', async () => {
            for (let i = 0; i < 1002; i++) {
                const a = await approvalService.createPendingAction({
                    type: 'consulta_saldo', description: `d${i}`, requestedBy: 'u', payload: {},
                });
                approvalService.moveToHistory(a);
            }

            const history = await approvalService.getActionHistory();
            expect(history.length).toBeLessThanOrEqual(1000);
        });
    });

    describe('getRiskLevel default', () => {
        it('returns medium for unknown type', async () => {
            const action = await approvalService.createPendingAction({
                type: 'unknown_type' as any,
                description: 'd',
                requestedBy: 'u',
                payload: {},
            });
            expect(action.riskLevel).toBe('medium');
        });
    });
});
