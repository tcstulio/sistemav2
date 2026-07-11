/**
 * Tests for ItauBankDashboard — Boleto address from client (#989)
 *
 * Verifies that the boleto dialog collects the real address from the selected
 * Dolibarr client (address, town, zip) instead of using hardcoded fake values,
 * with an explicit warning + disabled submit when the address is incomplete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Hoisted mocks (shared between vi.mock factories and test body) ---
const { mockEmitirBoleto, mockCustomers } = vi.hoisted(() => ({
    mockEmitirBoleto: vi.fn(),
    mockCustomers: [
        {
            id: '1',
            name: 'Empresa ABC Ltda',
            idprof1: '12345678000199',
            address: 'Av. Paulista, 1000',
            town: 'São Paulo',
            zip: '01310100',
            status: '1' as const,
            client: '1',
            fournisseur: '0',
        },
        {
            id: '2',
            name: 'João Silva ME',
            idprof1: '12345678901',
            address: '',
            town: '',
            zip: '',
            status: '1' as const,
            client: '1',
            fournisseur: '0',
        },
    ],
}));

// --- Module mocks ---
vi.mock('../../hooks/useItauBank', () => ({
    useItauBank: () => ({
        status: { initialized: true, environment: 'sandbox' },
        saldo: { disponivel: 1000, bloqueado: 0, limite: 5000 },
        saldoLoading: false,
        refetchSaldo: vi.fn(),
        isInitialized: true,
        useExtrato: () => ({ data: { transacoes: [] }, isLoading: false, refetch: vi.fn() }),
        usePixRecebidos: () => ({ data: { pix: [] }, isLoading: false, refetch: vi.fn() }),
        useBoletos: () => ({ data: { data: [] }, isLoading: false, refetch: vi.fn() }),
        criarPixCobranca: vi.fn(),
        criarPixLoading: false,
        emitirBoleto: mockEmitirBoleto,
        emitirBoletoLoading: false,
        api: { downloadBoletoPdf: vi.fn() },
    }),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: () => ({ config: { apiUrl: 'https://test.dolibarr.com', apiKey: 'test-key' } }),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useCustomers: () => ({ data: mockCustomers }),
}));

vi.mock('../../utils/logger', () => ({
    logger: {
        child: vi.fn(() => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })),
    },
}));

// Import component AFTER mocks
import { ItauBankDashboard } from './ItauBankDashboard';

// --- Helpers ---

/** Opens the boleto dialog by clicking "Novo Boleto". */
async function openBoletoDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText('Novo Boleto'));
}

/** Returns the "Emitir Boleto" submit button (avoids ambiguity with the dialog <h3>). */
function getEmitirBtn(): HTMLButtonElement {
    return screen.getByRole('button', { name: /Emitir Boleto/i });
}

describe('ItauBankDashboard — Boleto address from client (#989)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders client selector dropdown in the boleto dialog', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        expect(screen.getByText('Cliente (Dolibarr)')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        // Customer names appear as options
        expect(screen.getByText('Empresa ABC Ltda')).toBeInTheDocument();
        expect(screen.getByText('João Silva ME')).toBeInTheDocument();
    });

    it('auto-fills pagador fields from selected client (address, town, zip, name, document)', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        await user.selectOptions(screen.getByRole('combobox'), '1');

        // Address data from Dolibarr ThirdParty
        expect(screen.getByLabelText('Logradouro')).toHaveValue('Av. Paulista, 1000');
        expect(screen.getByLabelText('Cidade')).toHaveValue('São Paulo');
        expect(screen.getByLabelText('CEP')).toHaveValue('01310100');
        // Name and document also auto-filled
        expect(screen.getByLabelText('Nome do Pagador')).toHaveValue('Empresa ABC Ltda');
        expect(screen.getByLabelText('CPF/CNPJ')).toHaveValue('12345678000199');
    });

    it('shows warning and disables submit when no address data is entered', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        expect(screen.getByText(/Endereço do pagador incompleto/i)).toBeInTheDocument();
        expect(getEmitirBtn()).toBeDisabled();
    });

    it('keeps warning visible when client lacks UF and bairro (not in Dolibarr)', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        await user.selectOptions(screen.getByRole('combobox'), '1');

        // ThirdParty has no UF/bairro → still incomplete
        expect(screen.getByText(/Endereço do pagador incompleto/i)).toBeInTheDocument();
        expect(getEmitirBtn()).toBeDisabled();
    });

    it('does NOT fill fake values when client has empty address', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        // Select client #2 which has empty address/town/zip
        await user.selectOptions(screen.getByRole('combobox'), '2');

        expect(screen.getByLabelText('Logradouro')).toHaveValue('');
        expect(screen.getByLabelText('Cidade')).toHaveValue('');
        expect(screen.getByLabelText('CEP')).toHaveValue('');
        expect(screen.getByText(/Endereço do pagador incompleto/i)).toBeInTheDocument();
    });

    it('hides warning and enables submit when all address fields are filled', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        // Select client → fills logradouro, cidade, cep
        await user.selectOptions(screen.getByRole('combobox'), '1');
        // Manually fill bairro and UF (not available from Dolibarr ThirdParty)
        await user.type(screen.getByLabelText('Bairro'), 'Centro');
        await user.type(screen.getByLabelText('UF'), 'RJ');

        expect(screen.queryByText(/Endereço do pagador incompleto/i)).not.toBeInTheDocument();
        expect(getEmitirBtn()).not.toBeDisabled();
    });

    it('emits boleto with real client address — never fake values', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        // Fill required non-address fields
        await user.type(screen.getByLabelText('Valor (R$)'), '1500');
        await user.type(screen.getByLabelText('Vencimento'), '2025-12-31');

        // Select client → fills logradouro, cidade, cep, nome, cpf/cnpj
        await user.selectOptions(screen.getByRole('combobox'), '1');
        // Fill remaining address fields
        await user.type(screen.getByLabelText('Bairro'), 'Centro');
        await user.type(screen.getByLabelText('UF'), 'RJ');

        // Submit
        await user.click(getEmitirBtn());

        await waitFor(() => {
            expect(mockEmitirBoleto).toHaveBeenCalledTimes(1);
        });

        const endereco = mockEmitirBoleto.mock.calls[0][0].dado_boleto.pagador.endereco;

        // Real values from Dolibarr client
        expect(endereco.nome_logradouro).toBe('Av. Paulista, 1000');
        expect(endereco.nome_cidade).toBe('São Paulo');
        expect(endereco.numero_CEP).toBe('01310100');
        // Manually filled (not in ThirdParty)
        expect(endereco.nome_bairro).toBe('Centro');
        expect(endereco.sigla_UF).toBe('RJ');

        // Explicitly NOT the old fake literals
        expect(endereco.nome_logradouro).not.toBe('Não informado');
        expect(endereco.nome_bairro).not.toBe('Não informado');
        expect(endereco.nome_cidade).not.toBe('Não informado');
        expect(endereco.numero_CEP).not.toBe('00000000');
    });

    it('keeps submit disabled when CEP has wrong number of digits', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        await user.selectOptions(screen.getByRole('combobox'), '1');
        await user.type(screen.getByLabelText('Bairro'), 'Centro');
        await user.type(screen.getByLabelText('UF'), 'SP');
        // Overwrite CEP (auto-filled as 01310100) with a short, invalid CEP
        await user.clear(screen.getByLabelText('CEP'));
        await user.type(screen.getByLabelText('CEP'), '12345');

        // CEP has only 5 digits → still incomplete
        expect(screen.getByText(/Endereço do pagador incompleto/i)).toBeInTheDocument();
        expect(getEmitirBtn()).toBeDisabled();
    });

    it('normalizes UF to uppercase in the emitted payload', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);
        await openBoletoDialog(user);

        await user.type(screen.getByLabelText('Valor (R$)'), '500');
        await user.type(screen.getByLabelText('Vencimento'), '2025-12-31');
        await user.selectOptions(screen.getByRole('combobox'), '1');
        await user.type(screen.getByLabelText('Bairro'), 'Centro');
        // Type lowercase — onChange uppercases the field value
        await user.type(screen.getByLabelText('UF'), 'rj');

        // Field value should be uppercased by the onChange handler
        expect(screen.getByLabelText('UF')).toHaveValue('RJ');

        await user.click(getEmitirBtn());

        await waitFor(() => {
            expect(mockEmitirBoleto).toHaveBeenCalledTimes(1);
        });

        const endereco = mockEmitirBoleto.mock.calls[0][0].dado_boleto.pagador.endereco;
        // Payload always receives uppercase UF regardless of input case
        expect(endereco.sigla_UF).toBe('RJ');
    });
});
