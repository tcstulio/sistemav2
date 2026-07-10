import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { CustomerList } from '../../components/CustomerList';
import { useCustomers } from '../../hooks/dolibarr';
import { useCustomerMutations } from '../../hooks/useMutations';
import type { ThirdParty } from '../../types';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'https://test.dolibarr.com/api', apiKey: 'test-key' },
        refreshData: vi.fn(),
        canAccess: () => true,
        canDo: () => true,
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useCustomers: vi.fn(() => ({
        data: [
            { id: '1', name: 'ACME Ltda', client: '1', status: '1', fournisseur: '0', email: 'acme@example.com', town: 'São Paulo' },
            { id: '2', name: 'Prospecto XYZ', client: '2', status: '1', fournisseur: '0', email: 'xyz@example.com', town: 'Rio de Janeiro' },
        ] as ThirdParty[],
        isLoading: false,
        refetch: vi.fn(),
    })),
    useInvoices: vi.fn(() => ({ data: [] })),
    useProposals: vi.fn(() => ({ data: [] })),
    useOrders: vi.fn(() => ({ data: [] })),
    useProjects: vi.fn(() => ({ data: [] })),
    useEvents: vi.fn(() => ({ data: [] })),
    useTickets: vi.fn(() => ({ data: [] })),
    useShipments: vi.fn(() => ({ data: [] })),
    useContacts: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../hooks/usePrefill', () => ({
    usePrefill: vi.fn(() => null),
}));

vi.mock('../../hooks/useMutations', () => ({
    useCustomerMutations: vi.fn(() => ({
        createCustomer: { mutateAsync: vi.fn() },
        updateCustomer: { mutateAsync: vi.fn() },
    })),
}));

vi.mock('../../services/aiService', () => ({
    AiService: {
        draftMessage: vi.fn(),
        analyzeCustomerSentiment: vi.fn(),
        extractCustomerInfo: vi.fn(),
        logCorrection: vi.fn(),
    },
}));

vi.mock('../../components/common/LinkedObjects', () => ({
    LinkedObjects: () => <div data-testid="linked-objects" />,
}));

vi.mock('react-window', () => ({
    FixedSizeList: ({ children, itemCount }: any) => (
        <div data-testid="virtual-list">
            {Array.from({ length: itemCount }, (_, index) =>
                children({ index, style: {} })
            )}
        </div>
    ),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
    __esModule: true,
    default: ({ children }: any) => <>{children({ height: 600, width: 400 })}</>,
}));

describe('CustomerList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('renderiza o rótulo "Prospecto" para cliente com client=2', () => {
        render(<CustomerList />);
        // Badge na linha do cliente com client='2' e aba de filtro ambos têm "Prospecto"
        const prospectElements = screen.getAllByText('Prospecto');
        expect(prospectElements.length).toBeGreaterThan(0);
        // Garante que a badge do cliente com client='2' exibe "Prospecto"
        const badge = prospectElements.find(el => el.tagName.toLowerCase() === 'span');
        expect(badge).toBeTruthy();
        // Garante que "Prospect" sem "o" não aparece isolado
        const prospectMatches = screen.queryAllByText(/^Prospect$/);
        expect(prospectMatches).toHaveLength(0);
    });

    it('filtra corretamente ao clicar na aba "Prospecto"', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        // Inicialmente ambos aparecem
        expect(screen.getByText('ACME Ltda')).toBeInTheDocument();
        expect(screen.getByText('Prospecto XYZ')).toBeInTheDocument();

        // Clica na aba de filtro "Prospecto" (o Tab com value="prospect")
        // Há múltiplos elementos com "Prospecto" (badge + aba), pegar o botão
        const tabButtons = screen.getAllByRole('button', { name: 'Prospecto' });
        // O tab de filtro é um button com texto exato "Prospecto"
        const filterTab = tabButtons.find(btn => btn.closest('[class*="flex gap"]'));
        await user.click(filterTab ?? tabButtons[0]);

        // Após filtrar, apenas o prospecto deve aparecer
        await waitFor(() => {
            expect(screen.queryByText('ACME Ltda')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Prospecto XYZ')).toBeInTheDocument();
    });

    it('container das ações do cabeçalho possui flex-wrap', () => {
        const { container } = render(<CustomerList />);
        // O div que envolve ListToolbar + botão "Novo" deve ter flex-wrap
        const actionsDiv = container.querySelector('.flex.items-center.flex-wrap');
        expect(actionsDiv).not.toBeNull();
        expect(actionsDiv?.className).toContain('flex-wrap');
    });

    it('formulário de criação renderiza campos estendidos (CNPJ, WhatsApp, Site)', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        const newButton = screen.getByRole('button', { name: /novo/i });
        await user.click(newButton);

        expect(screen.getByLabelText(/cnpj \/ cpf/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/whatsapp \/ celular/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/site/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/nome fantasia/i)).toBeInTheDocument();
    });

    it('campo Responsável Legal aparece para PJ e some para PF', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        const newButton = screen.getByRole('button', { name: /novo/i });
        await user.click(newButton);

        // Por padrão (sem typent_id) o campo deve aparecer
        expect(screen.getByLabelText(/responsável legal/i)).toBeInTheDocument();

        // Encontrar o select de Tipo de Pessoa pelo texto das options
        const selects = screen.getAllByRole('combobox');
        const tipoPessoa = selects.find(s => {
            const opts = Array.from(s.querySelectorAll('option')).map(o => o.textContent);
            return opts.includes('Pessoa Física') && opts.includes('Empresa (PJ)');
        });
        expect(tipoPessoa).toBeDefined();

        // Selecionar Pessoa Física — campo some
        await user.selectOptions(tipoPessoa!, '8');
        expect(screen.queryByLabelText(/responsável legal/i)).not.toBeInTheDocument();

        // Selecionar Empresa (PJ) — campo volta
        await user.selectOptions(tipoPessoa!, '5');
        expect(screen.getByLabelText(/responsável legal/i)).toBeInTheDocument();
    });

    // ── Issue #606: Paginação morta removida ──────────────────────────────────
    it('#606 (A) não renderiza controles de paginação no rodapé da lista', () => {
        render(<CustomerList />);
        // PaginationControls foi removido — não deve haver select com opções "10", "20", "50"
        const selects = screen.queryAllByRole('combobox');
        const pagSelect = selects.find(s => {
            const opts = Array.from(s.querySelectorAll('option')).map(o => o.textContent?.trim());
            return opts.includes('10') && opts.includes('20') && opts.includes('50');
        });
        expect(pagSelect).toBeUndefined();
    });

    it('#606 (A) com múltiplos clientes todos aparecem via scroll (sem paginação)', () => {
        // O mock de react-window renderiza todos os itens — confirma que ambos os clientes estão no DOM
        render(<CustomerList />);
        expect(screen.getByText('ACME Ltda')).toBeInTheDocument();
        expect(screen.getByText('Prospecto XYZ')).toBeInTheDocument();
    });

    // ── Issue #606: Aba inválida no localStorage → fallback para overview ──────
    it('#606 aba inválida "timeline" no localStorage cai para overview e exibe conteúdo', async () => {
        // Simula versão anterior que persistiu "timeline" (aba removida)
        localStorage.setItem('coolgroove_customer_tab', 'timeline');
        const user = userEvent.setup();
        render(<CustomerList />);

        // Clica no primeiro cliente para abrir o painel de detalhe
        const customerCard = screen.getByText('ACME Ltda');
        await user.click(customerCard);

        // O painel de detalhe deve renderizar conteúdo — o bloco overview exibe "Informações"
        await waitFor(() => {
            expect(screen.getByText('Informações')).toBeInTheDocument();
        });
    });

    it('#606 aba desconhecida "shipments" no localStorage cai para overview', async () => {
        localStorage.setItem('coolgroove_customer_tab', 'shipments');
        const user = userEvent.setup();
        render(<CustomerList />);

        const customerCard = screen.getByText('ACME Ltda');
        await user.click(customerCard);

        await waitFor(() => {
            expect(screen.getByText('Informações')).toBeInTheDocument();
        });
    });

    it('#606 aba válida "invoices" no localStorage mantém a aba correta', async () => {
        localStorage.setItem('coolgroove_customer_tab', 'invoices');
        const user = userEvent.setup();
        render(<CustomerList />);

        const customerCard = screen.getByText('ACME Ltda');
        await user.click(customerCard);

        // A aba Faturas deve ficar ativa — "Nenhuma fatura encontrada" aparece (dados mock vazios)
        await waitFor(() => {
            expect(screen.getByText(/nenhuma fatura encontrada/i)).toBeInTheDocument();
        });
    });

    // ── Issue #822: button aninhado em button (erro de hidratação) ────────────
    it('#822 não renderiza <button> aninhado em <button> na lista de clientes', () => {
        const { container } = render(<CustomerList />);
        // O card clicável da linha do cliente agora é um <div role="button">,
        // não um <button> real — então o botão de excluir interno não gera
        // button-dentro-de-button (causa do erro de hidratação).
        const nestedButtonButtons = container.querySelectorAll('button button');
        expect(nestedButtonButtons).toHaveLength(0);
    });

    it('#822 o card da linha é um elemento clicável acessível (role=button) e não um <button>', () => {
        const { container } = render(<CustomerList />);
        // O texto do nome do cliente mora dentro do card clicável.
        const acmeText = screen.getByText('ACME Ltda');
        const card = acmeText.closest('[role="button"]');
        expect(card).not.toBeNull();
        expect(card).toHaveAttribute('tabindex', '0');
        // Garante que NÃO é um <button> real.
        expect((card as HTMLElement).tagName).not.toBe('BUTTON');
        // Sanity: existem cards clicáveis na lista.
        expect(container.querySelectorAll('[role="button"]')).not.toBeNull();
    });

    it('#822 clicar no card abre o detalhe; o botão de excluir permanece acessível', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        // Clicar no card (div role=button) abre o painel de detalhe.
        await user.click(screen.getByText('ACME Ltda'));
        expect(await screen.findByText('Informações')).toBeInTheDocument();

        // Os botões de excluir continuam presentes e são <button> independentes.
        const deleteButtons = screen.getAllByRole('button', { name: 'Excluir' });
        expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it('#822 clicar no botão de excluir NÃO abre o detalhe (stopPropagation)', async () => {
        const user = userEvent.setup();
        render(<CustomerList />);

        const deleteButtons = screen.getAllByRole('button', { name: 'Excluir' });
        await user.click(deleteButtons[0]);

        // Não deve ter aberto o painel de detalhe.
        expect(screen.queryByText('Informações')).not.toBeInTheDocument();
        // Deve ter aberto o modal de confirmação de exclusão.
        expect(await screen.findByText(/tem certeza que deseja excluir/i)).toBeInTheDocument();
    });
});

// ── #1095: ao salvar a edição do cliente, o estado/cache não deve ser mutado ──
//    diretamente (Object.assign(selectedCustomer, editForm)). Deve-se criar um
//    novo objeto via setSelectedCustomer imutável, preservando o cache original.
describe('CustomerList — Atualização imutável ao salvar edição (#1095)', () => {
    let acme: ThirdParty;
    let updateMutate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        acme = {
            id: '1',
            name: 'ACME Ltda',
            client: '1',
            status: '1',
            fournisseur: '0',
            email: 'acme@example.com',
            town: 'São Paulo',
        };
        updateMutate = vi.fn().mockResolvedValue({});
        vi.mocked(useCustomers).mockReturnValue({
            data: [
                acme,
                { id: '2', name: 'Prospecto XYZ', client: '2', status: '1', fournisseur: '0' } as ThirdParty,
            ],
            isLoading: false,
            refetch: vi.fn(),
        } as any);
        vi.mocked(useCustomerMutations).mockReturnValue({
            createCustomer: { mutateAsync: vi.fn() },
            updateCustomer: { mutateAsync: updateMutate },
        } as any);
    });

    it('salva edição criando novo objeto de estado (sem mutar o cache) e reflete na UI', async () => {
        const user = userEvent.setup();
        const { container } = render(<CustomerList />);

        // Abre o detalhe do cliente
        await user.click(screen.getByText('ACME Ltda'));
        expect(await screen.findByText('Informações')).toBeInTheDocument();

        // Abre o modal de edição (botão de lápis, sem texto acessível)
        const editBtn = container.querySelector('.lucide-pencil')!.closest('button')!;
        await user.click(editBtn);
        expect(await screen.findByText('Editar Cliente')).toBeInTheDocument();

        // Altera o nome
        const nomeInput = screen.getByLabelText('Nome');
        await user.clear(nomeInput);
        await user.type(nomeInput, 'ACME Renomeado LTDA');

        // Salva
        await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }));

        await waitFor(() => {
            // mutateAsync chamado com id + editForm contendo o novo nome
            expect(updateMutate).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: '1',
                    data: expect.objectContaining({ name: 'ACME Renomeado LTDA' }),
                })
            );
            expect(toast.success).toHaveBeenCalledWith('Cliente atualizado com sucesso');
        });

        // CRÍTICO (#1095): o objeto original do cache NÃO foi mutado.
        // Antes do fix o código fazia `Object.assign(selectedCustomer, editForm)`.
        expect(acme.name).toBe('ACME Ltda');

        // A UI atualizou via estado imutável (novo objeto): o cabeçalho do
        // detalhe passa a exibir o novo nome.
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'ACME Renomeado LTDA' })).toBeInTheDocument();
        });
    });
});
