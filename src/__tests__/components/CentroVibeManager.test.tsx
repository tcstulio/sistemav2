import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useDolibarr } from '../../context/DolibarrContext';

// --- Mocks: isolar o manager do backend e dos filhos pesados ---
vi.mock('../../services/centrovibeService', () => ({
    CentroVibeService: {
        fetchData: vi.fn().mockResolvedValue({ schedule: [], artists: [], competitors: [], externalEvents: [] }),
        saveData: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ canDo: () => true })),
}));

// Filhos pesados do módulo CentroVibe (não são alvo deste teste)
vi.mock('../../components/CentroVibe/MonthView', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/YearView', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/ArtistList', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/ClusterList', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/RadarView', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/AssistantModal', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/VibeCheck', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/NewEventModal', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/EventDetailsModal', () => ({ default: () => null }));
vi.mock('../../components/CentroVibe/AgendaCard', () => ({ default: () => null }));

import CentroVibeManager from '../../components/CentroVibe/CentroVibeManager';

describe('CentroVibeManager (#853) — gating canDo no botão Novo Evento', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDolibarr).mockReturnValue({ canDo: () => true } as any);
    });

    it('admin (canDo true) vê o botão Novo Evento', async () => {
        render(<CentroVibeManager />);
        expect(await screen.findByText('Novo Evento')).toBeTruthy();
    });

    it('oculta o botão Novo Evento quando canDo("create","centrovibe") é falso', async () => {
        vi.mocked(useDolibarr).mockReturnValue({
            canDo: (action: string, scrn: string) => !(action === 'create' && scrn === 'centrovibe'),
        } as any);
        render(<CentroVibeManager />);
        // O botão "Advisor IA" do header aparece independente de permissão (âncora de carregamento)
        expect(await screen.findByText('Advisor IA')).toBeTruthy();
        expect(screen.queryByText('Novo Evento')).toBeNull();
    });

    it('sem permissão centrovibe: a página de visualização continua renderizando', async () => {
        vi.mocked(useDolibarr).mockReturnValue({ canDo: () => false } as any);
        render(<CentroVibeManager />);
        expect(await screen.findByText('Advisor IA')).toBeTruthy();
        expect(screen.queryByText('Novo Evento')).toBeNull();
    });
});
