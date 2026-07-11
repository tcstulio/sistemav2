import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentMarkdown } from '../../components/ui/AgentMarkdown';

describe('AgentMarkdown (#chat-markdown)', () => {
    it('renderiza markdown basico: negrito e lista (antes vinha como texto cru)', () => {
        render(<AgentMarkdown text={'**Proposta 303**\n\n- item um\n- item dois'} navigate={vi.fn()} />);
        // negrito vira <strong>, nao **texto**
        const strong = screen.getByText('Proposta 303');
        expect(strong.tagName).toBe('STRONG');
        expect(screen.getByText('item um').tagName).toBe('LI');
        // os asteriscos NAO aparecem no texto renderizado
        expect(screen.queryByText(/\*\*/)).toBeNull();
    });

    it('link markdown para caminho RELATIVO navega in-app (o bug da proposta 303)', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={'Veja a [Proposta 303](/proposals/303) aqui.'} navigate={navigate} />);
        const link = screen.getByText('Proposta 303');
        expect(link.tagName).toBe('A');
        fireEvent.click(link);
        expect(navigate).toHaveBeenCalledWith('/proposals/303');
    });

    it('link markdown com href relativo NAO recarrega a pagina (preventDefault + navigate)', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={'[fatura](/invoices/1099)'} navigate={navigate} />);
        const link = screen.getByText('fatura') as HTMLAnchorElement;
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(evt);
        expect(navigate).toHaveBeenCalledWith('/invoices/1099');
        expect(evt.defaultPrevented).toBe(true);
    });

    it('deeplink de criacao (?prefill=) vira BOTAO que navega in-app', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={'[criar proposta](/proposals/new?prefill=abc123)'} navigate={navigate} />);
        const btn = screen.getByRole('button');
        // usa o texto do link (melhor que label fixo) + sufixo de acao
        expect(btn.textContent).toMatch(/criar proposta/);
        expect(btn.textContent).toMatch(/↗/);
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith('/proposals/new?prefill=abc123');
    });

    it('URL externa http(s) abre em nova aba (target=_blank), nao navega in-app', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={'docs em [site](https://exemplo.com/x)'} navigate={navigate} />);
        const link = screen.getByText('site') as HTMLAnchorElement;
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
        fireEvent.click(link);
        expect(navigate).not.toHaveBeenCalled();
    });

    it('renderiza TABELA GFM (tools do agente usam tabela — precisa remark-gfm)', () => {
        const md = '| Ref | Valor |\n|---|---|\n| PROV303 | R$ 43.360 |';
        render(<AgentMarkdown text={md} navigate={vi.fn()} />);
        expect(screen.getByText('Ref').tagName).toBe('TH');
        expect(screen.getByText('PROV303').tagName).toBe('TD');
    });

    it('texto vazio nao quebra', () => {
        const { container } = render(<AgentMarkdown text={''} navigate={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('AgentMarkdown — HTML cru de tool convertido para link seguro (#chat-markdown)', () => {
    it('<a href="/proposals/303">Abrir proposta 303</a> vira link interno clicavel (o caso real das 2 respostas)', () => {
        const navigate = vi.fn();
        const raw = 'Encontrei: <a href="/proposals/303" class="text-blue-600 underline">Abrir proposta 303 →</a> pronto.';
        render(<AgentMarkdown text={raw} navigate={navigate} />);
        const link = screen.getByText(/Abrir proposta 303/);
        expect(link.tagName).toBe('A');
        // a tag <a ...> NAO aparece como texto cru
        expect(screen.queryByText(/href=/)).toBeNull();
        fireEvent.click(link);
        expect(navigate).toHaveBeenCalledWith('/proposals/303');
    });

    it('nao renderiza HTML arbitrario (seguranca): <script> fica inerte como texto', () => {
        render(<AgentMarkdown text={'ok <script>alert(1)</script> fim'} navigate={vi.fn()} />);
        // nenhum <script> real no DOM renderizado
        expect(document.querySelector('script')).toBeNull();
    });
});
