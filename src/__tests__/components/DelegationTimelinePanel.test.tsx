import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockSvc = vi.hoisted(() => ({ getDelegationEvents: vi.fn() }));
vi.mock('../../services/dolibarrService', () => ({ DolibarrService: mockSvc }));
vi.mock('../../utils/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));

import { DelegationTimelinePanel } from '../../components/Tasks/DelegationTimelinePanel';

const config = { apiUrl: '', apiKey: '' } as any;
const users = [{ id: '16', firstname: 'Bruno', lastname: 'Souza' }];

describe('DelegationTimelinePanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSvc.getDelegationEvents.mockResolvedValue([]);
    });

    it('vazio: mostra "Sem eventos ainda"', async () => {
        render(<DelegationTimelinePanel config={config} taskId="50" users={users} />);
        expect(await screen.findByText(/Sem eventos ainda/)).toBeInTheDocument();
    });

    it('lista os eventos com rótulo, nome do autor e Sistema p/ eventos automáticos', async () => {
        mockSvc.getDelegationEvents.mockResolvedValue([
            { type: 'accepted', at: '2026-06-09T12:00:00Z', by: '16' },
            { type: 'cobranca', at: '2026-06-11T09:00:00Z' }, // sem by -> Sistema
        ]);
        render(<DelegationTimelinePanel config={config} taskId="50" users={users} />);
        expect(await screen.findByText('Aceita')).toBeInTheDocument();
        expect(screen.getByText('Cobrança enviada')).toBeInTheDocument();
        expect(screen.getByText(/Bruno Souza/)).toBeInTheDocument();
        expect(screen.getByText(/Sistema/)).toBeInTheDocument();
    });

    it('mostra o destinatário (para quem) — "Sistema → Nome" (#526)', async () => {
        mockSvc.getDelegationEvents.mockResolvedValue([
            { type: 'cobranca', at: '2026-06-11T09:00:00Z', to: '16' }, // by ausente=Sistema; to=Bruno
        ]);
        render(<DelegationTimelinePanel config={config} taskId="50" users={users} />);
        expect(await screen.findByText('Cobrança enviada')).toBeInTheDocument();
        expect(screen.getByText((_, el) => el?.tagName === 'P' && /Sistema\s*→\s*Bruno Souza/.test(el.textContent || ''))).toBeInTheDocument();
    });
});
