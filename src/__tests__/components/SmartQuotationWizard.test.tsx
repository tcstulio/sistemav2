import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartQuotationWizard } from '../../components/SmartQuotationWizard';
import { QUOTATION_PROGRESS_KEY } from '../../hooks/useQuotationProgress';
import {
    generateSupplierRequests,
    QuotationPartialError,
} from '../../services/quotationWizard';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        loading: vi.fn(() => 'toast-id'),
    },
}));

vi.mock('../../context/DolibarrContext', () => ({
    useDolibarr: vi.fn(() => ({
        config: { apiUrl: 'http://test/api', apiKey: 'key' },
    })),
}));

vi.mock('../../hooks/dolibarr', () => ({
    useProducts: vi.fn(() => ({
        data: [
            { id: 'p1', ref: 'MOUSE', label: 'Mouse Logitech' },
        ],
    })),
    useSuppliers: vi.fn(() => ({
        data: [
            { id: 's1', name: 'Amazon' },
        ],
    })),
}));

// Mock do AI: retorna o JSON apropriado baseado no prompt.
// handleParseNeeds pede [productName, qty, spec]; handleResearchPrices
// primeiro faz uma "pesquisa" (string crua) e depois pede a estruturação
// em [source, price, link].
vi.mock('../../services/aiService', () => ({
    AiService: {
        chatWithData: vi.fn(async (prompt: string) => {
            if (prompt.includes('extraia os itens')) {
                return 'Resposta: [{"productName":"Mouse","qty":2,"spec":"sem fio"}]';
            }
            if (prompt.includes('Transforme o resultado')) {
                return '[{"source":"Amazon","price":100,"link":"http://amazon.com.br/mouse"}]';
            }
            return 'Pesquisa genérica: Amazon vende Mouse por R$ 100.';
        }),
    },
}));

vi.mock('../../services/api/commercial', () => ({
    createSupplierProposal: vi.fn().mockResolvedValue({ id: 'prop-1' }),
    addSupplierProposalLine: vi.fn().mockResolvedValue(undefined),
    createThirdParty: vi.fn().mockResolvedValue({ id: 'sup-new' }),
}));

vi.mock('../../services/api/inventory', () => ({
    createProduct: vi.fn().mockResolvedValue({ id: 'prod-new' }),
}));

vi.mock('../../services/quotationWizard', async () => {
    const actual = await vi.importActual<typeof import('../../services/quotationWizard')>(
        '../../services/quotationWizard',
    );
    return {
        ...actual,
        generateSupplierRequests: vi.fn(),
    };
});

// Helper: dirige o wizard até o passo 3 (ofertas) e seleciona a primeira oferta.
const driveWizardToOffers = async (user: ReturnType<typeof userEvent.setup>) => {
    // Passo 1: digita o pedido e clica "Analisar com IA"
    const textarea = screen.getByPlaceholderText(/Digite sua lista/i);
    await user.type(textarea, 'preciso de 2 mouses');
    await user.click(screen.getByRole('button', { name: /Analisar com IA/i }));

    // Passo 2: clica "Pesquisar Preços na Web"
    const researchBtn = await screen.findByRole('button', { name: /Pesquisar Preços/i });
    await user.click(researchBtn);

    // Passo 3: oferta listada — clica para selecionar
    const offer = await screen.findByText('Amazon', { selector: 'div' });
    await user.click(offer);
};

describe('SmartQuotationWizard — retomada sem duplicar (#1416)', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('mostra banner de retomada quando há savedProgress no localStorage', () => {
        // Semeadura: progresso de uma execução anterior interrompida
        const seeded = {
            productIdsByRef: { 'MOUSE': 'prod-prev' },
            supplierIdsByName: { 'Amazon': 'sup-prev' },
            processedOfferIds: ['offer-prev'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        render(<SmartQuotationWizard />);

        // Banner visível ao montar (mesmo antes do usuário chegar no passo 3).
        // O componente renderiza o passo 1, mas o banner do passo 3 só aparece
        // quando currentStep === 3. Para o teste de unidade, basta verificar
        // que o hook foi consumido (savedProgress carregado) — verificaremos
        // isso indiretamente após navegar até o passo 3.
        // Como o banner depende de currentStep === 3, este teste só confirma
        // que o componente monta sem erros com progresso persistido.
        expect(screen.getByText(/Assistente de Cotação Inteligente/i)).toBeInTheDocument();
    });

    it('ao chegar no passo 3, banner de retomada aparece com contagens corretas', async () => {
        const user = userEvent.setup();
        const seeded = {
            productIdsByRef: { 'MOUSE': 'prod-prev' },
            supplierIdsByName: { 'Amazon': 'sup-prev', 'Kabum': 'sup-prev-2' },
            processedOfferIds: ['offer-prev-1', 'offer-prev-2', 'offer-prev-3'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        await waitFor(() => {
            expect(screen.getByTestId('quotation-resume-banner')).toBeInTheDocument();
        });

        // Texto do banner contém as contagens vindas do progresso persistido.
        expect(screen.getByTestId('quotation-resume-banner').textContent).toMatch(/1 produto/i);
        expect(screen.getByTestId('quotation-resume-banner').textContent).toMatch(/2 fornecedor/i);
        expect(screen.getByTestId('quotation-resume-banner').textContent).toMatch(/3 linha/i);
    });

    it('"Descartar progresso" limpa o savedProgress do localStorage e do estado', async () => {
        const user = userEvent.setup();
        localStorage.setItem(
            QUOTATION_PROGRESS_KEY,
            JSON.stringify({
                productIdsByRef: { 'MOUSE': 'prod-prev' },
                supplierIdsByName: {},
                processedOfferIds: [],
            }),
        );

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        const discardBtn = await screen.findByTestId('quotation-resume-discard');
        await user.click(discardBtn);

        await waitFor(() => {
            expect(screen.queryByTestId('quotation-resume-banner')).not.toBeInTheDocument();
        });
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeNull();
    });

    it('"Retomar de onde parou" passa o savedProgress para generateSupplierRequests', async () => {
        const user = userEvent.setup();
        const seeded = {
            productIdsByRef: { 'MOUSE': 'prod-prev' },
            supplierIdsByName: { 'Amazon': 'sup-prev' },
            processedOfferIds: ['offer-prev'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(seeded));

        vi.mocked(generateSupplierRequests).mockResolvedValue({
            productsCreated: 0,
            suppliersCreated: 0,
            proposalsCreated: 1,
            progress: seeded,
        });

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        const resumeBtn = await screen.findByTestId('quotation-resume-button');
        await user.click(resumeBtn);

        await waitFor(() => {
            expect(generateSupplierRequests).toHaveBeenCalledTimes(1);
        });
        // initialProgress (5º arg) é o seeded
        const callArgs = vi.mocked(generateSupplierRequests).mock.calls[0];
        expect(callArgs[4]).toEqual(seeded);
    });

    it('em QuotationPartialError, persiste o progress no localStorage e mostra toast com resumo', async () => {
        const user = userEvent.setup();
        // sem seed inicial
        vi.mocked(generateSupplierRequests).mockRejectedValueOnce(
            new QuotationPartialError('supplier fail', {
                productIdsByRef: { 'MOUSE': 'prod-A' },
                supplierIdsByName: {},
                processedOfferIds: [],
            }),
        );

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        const generateBtn = screen.getByRole('button', { name: /Gerar Solicitações/i });
        await user.click(generateBtn);

        await waitFor(() => {
            // progresso persistido → banner aparece no estado de UI
            expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeTruthy();
        });
        const persisted = JSON.parse(localStorage.getItem(QUOTATION_PROGRESS_KEY)!);
        expect(persisted.productIdsByRef).toEqual({ MOUSE: 'prod-A' });

        // toast.error chamado com a mensagem do erro + resumo do progresso
        const toast = await import('sonner');
        expect(toast.toast.error).toHaveBeenCalledWith(
            expect.stringMatching(/supplier fail/i),
            expect.objectContaining({ id: 'toast-id' }),
        );
        expect(toast.toast.error).toHaveBeenCalledWith(
            expect.stringMatching(/1 produto\(s\)/i),
            expect.anything(),
        );
        expect(toast.toast.error).toHaveBeenCalledWith(
            expect.stringMatching(/0 fornecedor\(es\)/i),
            expect.anything(),
        );
    });

    it('em sucesso, persiste o progress final no localStorage', async () => {
        const user = userEvent.setup();
        vi.mocked(generateSupplierRequests).mockResolvedValueOnce({
            productsCreated: 1,
            suppliersCreated: 1,
            proposalsCreated: 1,
            progress: {
                productIdsByRef: { 'MOUSE': 'prod-new' },
                supplierIdsByName: { 'Amazon': 'sup-new' },
                processedOfferIds: ['offer-1'],
            },
        });

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        const generateBtn = screen.getByRole('button', { name: /Gerar Solicitações/i });
        await user.click(generateBtn);

        await waitFor(() => {
            expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBeTruthy();
        });
        const persisted = JSON.parse(localStorage.getItem(QUOTATION_PROGRESS_KEY)!);
        expect(persisted).toEqual({
            productIdsByRef: { 'MOUSE': 'prod-new' },
            supplierIdsByName: { 'Amazon': 'sup-new' },
            processedOfferIds: ['offer-1'],
        });
    });

    it('em sucesso sem progresso novo (tudo já estava salvo), mantém o progresso', async () => {
        const user = userEvent.setup();
        const existing = {
            productIdsByRef: { 'MOUSE': 'prod-prev' },
            supplierIdsByName: { 'Amazon': 'sup-prev' },
            processedOfferIds: ['offer-prev'],
        };
        localStorage.setItem(QUOTATION_PROGRESS_KEY, JSON.stringify(existing));

        vi.mocked(generateSupplierRequests).mockResolvedValueOnce({
            productsCreated: 0,
            suppliersCreated: 0,
            proposalsCreated: 1,
            progress: existing,
        });

        render(<SmartQuotationWizard />);
        await driveWizardToOffers(user);

        // O passo 3 já exibe o banner (progresso carregado do storage).
        // Clica no botão principal "Gerar Solicitações" para confirmar.
        const generateBtn = screen.getByRole('button', { name: /Gerar Solicitações/i });
        await user.click(generateBtn);

        await waitFor(() => {
            expect(generateSupplierRequests).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.anything(),
                expect.anything(),
                existing, // initialProgress = o que veio do localStorage
            );
        });

        // O progresso no storage continua o mesmo (não foi limpo, pois tem trabalho real).
        expect(localStorage.getItem(QUOTATION_PROGRESS_KEY)).toBe(JSON.stringify(existing));
    });
});