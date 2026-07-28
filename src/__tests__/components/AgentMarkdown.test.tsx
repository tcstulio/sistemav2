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

describe('AgentMarkdown — deeplink de confirmação HITL vira BOTÃO curto (#1358)', () => {
    const bigToken = 'eyJ' + 'x'.repeat(380); // token HMAC ~400 chars
    const confirmUrl = `/confirm-action?token=${bigToken}`;

    it('markdown cujo TEXTO é a própria URL gigante vira botão "Revisar e confirmar" (não texto cru)', () => {
        const navigate = vi.fn();
        // o caso real: o modelo usou a URL como texto do link → [/confirm-action?token=...](/confirm-action?token=...)
        render(<AgentMarkdown text={`[${confirmUrl}](${confirmUrl})`} navigate={navigate} />);
        const btn = screen.getByRole('button');
        expect(btn.textContent).toMatch(/Revisar e confirmar/);
        // o token gigante NÃO aparece renderizado
        expect(screen.queryByText(new RegExp(bigToken.slice(0, 30)))).toBeNull();
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith(confirmUrl);
    });

    it('se o modelo deu um texto decente, o botão respeita esse texto', () => {
        render(<AgentMarkdown text={`[Confirmar validação da PROV303](${confirmUrl})`} navigate={vi.fn()} />);
        expect(screen.getByRole('button').textContent).toMatch(/Confirmar validação da PROV303/);
    });

    it('confirm-action em HTML cru (<a href>) também vira botão, não link gigante', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={`<a href="${confirmUrl}">${confirmUrl}</a>`} navigate={navigate} />);
        const btn = screen.getByRole('button');
        expect(btn.textContent).toMatch(/Revisar e confirmar/);
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith(confirmUrl);
    });
});

describe('AgentMarkdown — deeplink SOLTO no texto vira botão (regressão do render antigo)', () => {
    // Desde #1355 a resposta de prepare_* é o texto cru da tool ("… na tela: /x/new?prefill=…"),
    // sem markdown. O render antigo (pré-#1354) linkificava por regex; o AgentMarkdown só tratava
    // markdown/anchor — o deeplink virava TEXTO MORTO. Estes testes pregam a reconstrução.
    const token = 'eyJ' + 'a'.repeat(120);

    it('caminho ?prefill= solto (resposta crua do prepare_*) vira botão que navega in-app', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={`Preparei o rascunho. Clique para revisar e confirmar a criação na tela: /tasks/new?prefill=${token}`} navigate={navigate} />);
        const btn = screen.getByRole('button');
        expect(btn.textContent).toMatch(/Revisar e criar/);
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith(`/tasks/new?prefill=${token}`);
    });

    it('/confirm-action?token= solto vira botão "Revisar e confirmar"', () => {
        const navigate = vi.fn();
        render(<AgentMarkdown text={`Confirme aqui: /confirm-action?token=${token}`} navigate={navigate} />);
        const btn = screen.getByRole('button');
        expect(btn.textContent).toMatch(/Revisar e confirmar/);
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith(`/confirm-action?token=${token}`);
    });

    it('URL ABSOLUTA do próprio app com ?prefill= volta a ser relativa e vira botão (mensagens absolutizadas p/ WhatsApp)', () => {
        const navigate = vi.fn();
        const abs = `${window.location.origin}/customers/new?prefill=${token}`;
        render(<AgentMarkdown text={`Clique para revisar: ${abs}`} navigate={navigate} />);
        const btn = screen.getByRole('button');
        expect(btn.textContent).toMatch(/Revisar e criar/);
        fireEvent.click(btn);
        expect(navigate).toHaveBeenCalledWith(`/customers/new?prefill=${token}`);
    });

    it('deeplink JÁ em markdown não é re-embrulhado (sem botão duplicado)', () => {
        render(<AgentMarkdown text={`[criar tarefa](/tasks/new?prefill=${token})`} navigate={vi.fn()} />);
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button').textContent).toMatch(/criar tarefa/);
    });

    it('caminho relativo comum solto (sem prefill/token) segue como texto — só deeplink de AÇÃO é reconstruído', () => {
        render(<AgentMarkdown text={'Veja em /proposals/303 os detalhes.'} navigate={vi.fn()} />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });
});
