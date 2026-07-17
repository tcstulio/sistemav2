import { describe, it, expect } from 'vitest';
import { claimsWriteSuccess } from '../../utils/writeClaimGuard';

describe('claimsWriteSuccess (#1332)', () => {
    it('detecta o caso REAL do incidente (proposta 303)', () => {
        const incident = 'Proposta 303 validada com sucesso.\n\n✅ Status atualizado para **Validada**.\n\nQuer que eu já siga com algum próximo passo?';
        expect(claimsWriteSuccess(incident)).toBe(true);
    });

    it('detecta variações: criado/enviado/excluído com sinal de conclusão', () => {
        expect(claimsWriteSuccess('Pedido criado com sucesso! ID #55.')).toBe(true);
        expect(claimsWriteSuccess('E-mail enviado com sucesso para o cliente.')).toBe(true);
        expect(claimsWriteSuccess('Fatura excluída com sucesso ✅')).toBe(true);
        expect(claimsWriteSuccess('Pronto! O evento foi agendado com sucesso.')).toBe(true);
    });

    it('NÃO dispara em resposta de leitura/consulta', () => {
        expect(claimsWriteSuccess('Encontrei a proposta que você procura: PROV303, R$ 43.360,00.')).toBe(false);
        expect(claimsWriteSuccess('A fatura #10 está com status Paga desde ontem.')).toBe(false);
        expect(claimsWriteSuccess('Aqui estão os 5 pedidos abertos do cliente.')).toBe(false);
    });

    it('NÃO dispara em OFERTA/pergunta ("quer que eu valide?")', () => {
        expect(claimsWriteSuccess('Quer que a proposta seja validada com sucesso? Posso fazer isso agora.')).toBe(false);
        expect(claimsWriteSuccess('Deseja que o pedido seja criado com sucesso no sistema?')).toBe(false);
    });

    it('NÃO dispara em particípio sem sinal de conclusão (relato histórico)', () => {
        expect(claimsWriteSuccess('Este pedido foi criado em 2024 pelo usuário João.')).toBe(false);
        expect(claimsWriteSuccess('A proposta validada ontem consta no relatório.')).toBe(false);
    });

    it('acentos não escondem o match (validada/validado/excluída)', () => {
        expect(claimsWriteSuccess('Proposta VALIDADA com sucesso!')).toBe(true);
        expect(claimsWriteSuccess('Registro excluído com sucesso.')).toBe(true);
    });

    it('deeplink de confirmação (HITL) não é afirmação de sucesso', () => {
        expect(claimsWriteSuccess('⚠️ Esta ação tem efeito irreversível e exige CONFIRMAÇÃO HUMANA. Revise e confirme na tela: /confirm-action?token=abc')).toBe(false);
    });

    it('texto vazio/nulo → false', () => {
        expect(claimsWriteSuccess('')).toBe(false);
        expect(claimsWriteSuccess(undefined as any)).toBe(false);
    });

    // Red-team #1332 (2026-07-17): a 1ª pessoa do pretérito ("Cadastrei você...") NÃO casava os
    // particípios e a mentira conjugada passava livre — vetor da alucinação de "código de validação".
    it('detecta afirmação em 1ª pessoa (cadastrei/criei/validei/enviei) com sinal de conclusão', () => {
        expect(claimsWriteSuccess('Perfeito! Cadastrei você com sucesso. Seu código de validação é 1234.')).toBe(true);
        expect(claimsWriteSuccess('Validei a proposta 303 com sucesso ✅')).toBe(true);
        expect(claimsWriteSuccess('Criei a tarefa e já enviei a notificação. Feito!')).toBe(true);
        expect(claimsWriteSuccess('Paguei o boleto com sucesso.')).toBe(true);
    });

    it('CANÁRIO: o caso 303 sem tool permanece bloqueado (não regredir o gatilho)', () => {
        expect(claimsWriteSuccess('Proposta 303 validada com sucesso.')).toBe(true);
    });

    it('1ª pessoa SEM sinal de conclusão → false (relato/oferta)', () => {
        expect(claimsWriteSuccess('Aproveitei os dados da lista para montar o resumo.')).toBe(false); // 'aprovei' foi removido p/ evitar este FP
        expect(claimsWriteSuccess('Já validei muitas propostas parecidas antes.')).toBe(false); // sem sinal de conclusão da AÇÃO deste turno
    });
});
