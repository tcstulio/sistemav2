import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItauBankDashboard } from '../../components/Banking/ItauBankDashboard';

// ---------- Mocks ----------

const mockEmitirBoleto = vi.fn().mockResolvedValue({});
const mockRefetchBoletos = vi.fn();

vi.mock('../../hooks/useItauBank', () => ({
    useItauBank: vi.fn(() => ({
        status: { environment: 'sandbox' as const, initialized: true, hasCredentials: true, hasCertificates: true, tokenValid: true },
        saldo: { disponivel: 10000, bloqueado: 0, limite: 50000 },
        saldoLoading: false,
        refetchSaldo: vi.fn(),
        isInitialized: true,
        useExtrato: () => ({ data: { transacoes: [] }, isLoading: false, refetch: vi.fn() }),
        usePixRecebidos: () => ({ data: { pix: [] }, isLoading: false, refetch: vi.fn() }),
        useBoletos: () => ({ data: { data: [] }, isLoading: false, refetch: mockRefetchBoletos }),
        criarPixCobranca: vi.fn(),
        criarPixLoading: false,
        emitirBoleto: mockEmitirBoleto,
        emitirBoletoLoading: false,
        api: { downloadBoletoPdf: vi.fn() },
    })),
}));

const { useCustomersMock } = vi.hoisted(() => ({
    useCustomersMock: { data: [] as any[] },
}));

vi.mock('../../hooks/dolibarr', () => ({
    useCustomers: vi.fn(() => useCustomersMock),
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({ config: { apiUrl: 'http://test', apiKey: 'key' } })),
}));

// ---------- Helpers ----------

const fullAddressCustomer = {
    id: 'c1',
    name: 'Empresa Teste Ltda',
    idprof1: '12345678000199',
    address: 'Av. Paulista, 1000',
    town: 'São Paulo',
    zip: '01310100',
    status: '1' as const,
    client: '1',
    fournisseur: '0',
};

const incompleteAddressCustomer = {
    id: 'c2',
    name: 'Cliente Sem Endereço',
    idprof1: '98765432100',
    address: '',
    town: '',
    zip: '',
    status: '1' as const,
    client: '1',
    fournisseur: '0',
};

function setCustomers(list: any[]) {
    useCustomersMock.data = list;
}

// ---------- Tests ----------

describe('ItauBankDashboard — Boleto address from real customer data (#989)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEmitirBoleto.mockResolvedValue({});
        setCustomers([]);
    });

    it('opens the boleto dialog when "Novo Boleto" is clicked', async () => {
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        expect(screen.getByRole('heading', { name: 'Emitir Boleto' })).toBeInTheDocument();
        expect(screen.getByLabelText('Cliente (Dolibarr)')).toBeInTheDocument();
    });

    it('fills pagador address with real customer data when a customer is selected', async () => {
        setCustomers([fullAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c1');

        await waitFor(() => {
            expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Av. Paulista, 1000');
        });
        expect((screen.getByLabelText('Cidade') as HTMLInputElement).value).toBe('São Paulo');
        expect((screen.getByLabelText('CEP') as HTMLInputElement).value).toBe('01310100');
        expect((screen.getByLabelText('Nome do Pagador') as HTMLInputElement).value).toBe('Empresa Teste Ltda');
    });

    it('does NOT render any fake hardcoded values anywhere in the boleto dialog', async () => {
        setCustomers([fullAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c1');

        await waitFor(() => {
            expect((screen.getByLabelText('Logradouro') as HTMLInputElement).value).toBe('Av. Paulista, 1000');
        });

        const dialog = screen.getByRole('heading', { name: 'Emitir Boleto' }).closest('.fixed')!;
        expect(dialog.textContent).not.toContain('Nao informado');
        expect(dialog.textContent).not.toContain('00000000');
    });

    it('shows incomplete-address warning and disables emit button when customer lacks address', async () => {
        setCustomers([incompleteAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c2');

        await waitFor(() => {
            expect(screen.getByText(/Endereço do pagador incompleto/i)).toBeInTheDocument();
        });

        const emitBtn = screen.getByRole('button', { name: 'Emitir Boleto' });
        expect(emitBtn).toBeDisabled();
    });

    it('hides the incomplete-address warning when all fields are filled', async () => {
        setCustomers([fullAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c1');

        // Fill the remaining required fields (bairro, UF) not provided by customer
        await user.type(screen.getByLabelText('Bairro'), 'Bela Vista');
        await user.type(screen.getByLabelText('UF'), 'SP');
        await user.type(screen.getByLabelText('Valor (R$)'), '1500');
        await user.type(screen.getByLabelText('Vencimento'), '2030-12-31');

        await waitFor(() => {
            expect(screen.queryByText(/Endereço do pagador incompleto/i)).not.toBeInTheDocument();
        });
    });

    it('sends the real customer address (not fake) when emitting the boleto', async () => {
        setCustomers([fullAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c1');

        await user.type(screen.getByLabelText('Bairro'), 'Bela Vista');
        await user.type(screen.getByLabelText('UF'), 'SP');
        await user.type(screen.getByLabelText('Valor (R$)'), '1500');
        await user.type(screen.getByLabelText('Vencimento'), '2030-12-31');

        await user.click(screen.getByRole('button', { name: 'Emitir Boleto' }));

        await waitFor(() => {
            expect(mockEmitirBoleto).toHaveBeenCalledTimes(1);
        });

        const callArg = mockEmitirBoleto.mock.calls[0][0];
        const endereco = callArg.dado_boleto.pagador.endereco;
        expect(endereco.nome_logradouro).toBe('Av. Paulista, 1000');
        expect(endereco.nome_cidade).toBe('São Paulo');
        expect(endereco.numero_CEP).toBe('01310100');
        expect(endereco.nome_bairro).toBe('Bela Vista');
        expect(endereco.sigla_UF).toBe('SP');

        // Ensure no fake values leaked into the request payload
        expect(JSON.stringify(callArg)).not.toContain('Nao informado');
        expect(JSON.stringify(callArg)).not.toContain('00000000');
    });

    it('refetches boletos list after a successful emission', async () => {
        setCustomers([fullAddressCustomer]);
        const user = userEvent.setup();
        render(<ItauBankDashboard />);

        await user.click(screen.getByText('Novo Boleto'));

        const select = screen.getByLabelText('Cliente (Dolibarr)');
        await user.selectOptions(select, 'c1');

        await user.type(screen.getByLabelText('Bairro'), 'Bela Vista');
        await user.type(screen.getByLabelText('UF'), 'SP');
        await user.type(screen.getByLabelText('Valor (R$)'), '1500');
        await user.type(screen.getByLabelText('Vencimento'), '2030-12-31');

        await user.click(screen.getByRole('button', { name: 'Emitir Boleto' }));

        await waitFor(() => {
            expect(mockRefetchBoletos).toHaveBeenCalled();
        });
    });
});
