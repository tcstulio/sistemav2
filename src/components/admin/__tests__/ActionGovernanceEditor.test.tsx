/**
 * Testes de COMPONENTE (RTL) para o issue #1209 — card admin de Governança de Ação.
 *
 * Cobrem os critérios de aceite:
 *  - Renderiza os 4 controles com os valores iniciais vindos da config.
 *  - Toggle altera o estado local.
 *  - Allowlist normaliza dígitos no onChange (+55abc1199990000 → 551199990000) e
 *    bloqueia o add quando o número tem < 8 ou > 15 dígitos (ex.: "123").
 *  - Threshold vazio é salvo como null.
 *  - Botão "Salvar" dispara updateUiConfig com o payload completo e mostra toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionGovernanceEditor } from '../ActionGovernanceEditor';
import type { ActionGovernanceConfig } from '../../../services/uiConfigService';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const { getUiConfigMock, updateUiConfigMock } = vi.hoisted(() => ({
    getUiConfigMock: vi.fn(),
    updateUiConfigMock: vi.fn(),
}));

vi.mock('../../../services/uiConfigService', () => ({
    getUiConfig: getUiConfigMock,
    updateUiConfig: updateUiConfigMock,
}));

const baseConfig: ActionGovernanceConfig = {
    irreversibleRequiresApproval: true,
    adminBypassIrreversible: false,
    approvalValueThreshold: 500,
    whatsappDestinationAllowlist: ['5511888800000'],
};

describe('ActionGovernanceEditor — #1209: renderização inicial e guardas', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
        updateUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
    });

    it('não renderiza nada quando o usuário não é admin', () => {
        const { container } = render(<ActionGovernanceEditor isAdmin={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renderiza os 4 controles com os valores iniciais vindos da config', async () => {
        render(<ActionGovernanceEditor isAdmin={true} />);

        const irreversible = await screen.findByTestId('gov-irreversible-toggle');
        const adminBypass = await screen.findByTestId('gov-admin-bypass-toggle');
        const threshold = await screen.findByTestId('gov-approval-threshold');
        const allowlist = await screen.findByTestId('gov-allowlist-input');

        expect((irreversible as HTMLInputElement).checked).toBe(true);
        expect((adminBypass as HTMLInputElement).checked).toBe(false);
        expect((threshold as HTMLInputElement).value).toBe('500');
        expect(allowlist).toBeTruthy();
        // Item pré-existente da allowlist aparece.
        expect(await screen.findByTestId('gov-allowlist-item-5511888800000')).toBeTruthy();
    });
});

describe('ActionGovernanceEditor — #1209: toggle altera estado local', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
        updateUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
    });

    it('clicar no toggle de bypass inverte o estado local', async () => {
        const user = userEvent.setup();
        render(<ActionGovernanceEditor isAdmin={true} />);

        const toggle = await screen.findByTestId('gov-admin-bypass-toggle');
        expect((toggle as HTMLInputElement).checked).toBe(false);

        await user.click(toggle);

        expect((toggle as HTMLInputElement).checked).toBe(true);
    });
});

describe('ActionGovernanceEditor — #1209: allowlist normaliza dígitos e bloqueia inválidos', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ actionGovernance: { ...baseConfig, whatsappDestinationAllowlist: [] } });
        updateUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
    });

    it('"+55abc1199990000" é normalizado para "551199990000" e pode ser adicionado', async () => {
        const user = userEvent.setup();
        render(<ActionGovernanceEditor isAdmin={true} />);

        const input = await screen.findByTestId('gov-allowlist-input');
        fireEvent.change(input, { target: { value: '+55abc1199990000' } });

        expect((input as HTMLInputElement).value).toBe('551199990000');

        const addBtn = screen.getByTestId('gov-allowlist-add') as HTMLButtonElement;
        expect(addBtn.disabled).toBe(false);

        await user.click(addBtn);

        expect(await screen.findByTestId('gov-allowlist-item-551199990000')).toBeTruthy();
        // Input é limpo após adicionar.
        expect((input as HTMLInputElement).value).toBe('');
    });

    it('"123" (3 dígitos) mantém o botão Adicionar desabilitado', async () => {
        render(<ActionGovernanceEditor isAdmin={true} />);

        const input = await screen.findByTestId('gov-allowlist-input');
        fireEvent.change(input, { target: { value: '123' } });

        expect((input as HTMLInputElement).value).toBe('123');
        const addBtn = screen.getByTestId('gov-allowlist-add') as HTMLButtonElement;
        expect(addBtn.disabled).toBe(true);
        // Mensagem de validação visível.
        expect(screen.getByTestId('gov-allowlist-error')).toBeTruthy();
    });

    it('remover um item da allowlist o tira da lista', async () => {
        const user = userEvent.setup();
        getUiConfigMock.mockResolvedValue({ actionGovernance: { ...baseConfig, whatsappDestinationAllowlist: ['551199990000'] } });
        render(<ActionGovernanceEditor isAdmin={true} />);

        const removeBtn = await screen.findByTestId('gov-allowlist-remove-551199990000');
        await user.click(removeBtn);

        expect(screen.queryByTestId('gov-allowlist-item-551199990000')).toBeNull();
    });
});

describe('ActionGovernanceEditor — #1209: salvar dispara updateUiConfig + toast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
        updateUiConfigMock.mockResolvedValue({ actionGovernance: baseConfig });
    });

    it('clica em Salvar e chama updateUiConfig com o objeto completo de actionGovernance', async () => {
        const { toast } = await import('sonner');
        const user = userEvent.setup();
        render(<ActionGovernanceEditor isAdmin={true} />);

        await screen.findByTestId('gov-save');
        await user.click(screen.getByTestId('gov-save'));

        await vi.waitFor(() => expect(updateUiConfigMock).toHaveBeenCalledTimes(1));
        const payload = updateUiConfigMock.mock.calls[0][0];
        expect(payload).toEqual({
            actionGovernance: {
                irreversibleRequiresApproval: true,
                adminBypassIrreversible: false,
                approvalValueThreshold: 500,
                whatsappDestinationAllowlist: ['5511888800000'],
            },
        });
        expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Governanca de acao salva'));
    });

    it('threshold vazio é salvo como null', async () => {
        const user = userEvent.setup();
        render(<ActionGovernanceEditor isAdmin={true} />);

        const threshold = await screen.findByTestId('gov-approval-threshold');
        fireEvent.change(threshold, { target: { value: '' } });
        expect((threshold as HTMLInputElement).value).toBe('');

        await user.click(screen.getByTestId('gov-save'));

        await vi.waitFor(() => expect(updateUiConfigMock).toHaveBeenCalledTimes(1));
        const payload = updateUiConfigMock.mock.calls[0][0];
        expect(payload.actionGovernance.approvalValueThreshold).toBeNull();
    });

    it('erro no save dispara toast de erro', async () => {
        const { toast } = await import('sonner');
        updateUiConfigMock.mockRejectedValue({ message: 'boom' });
        const user = userEvent.setup();
        render(<ActionGovernanceEditor isAdmin={true} />);

        await screen.findByTestId('gov-save');
        await user.click(screen.getByTestId('gov-save'));

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
        expect(toast.success).not.toHaveBeenCalled();
    });
});
