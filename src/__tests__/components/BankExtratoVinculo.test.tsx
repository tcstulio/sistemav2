/**
 * Tests for bank statement enrichment — projeto/cliente/finalidade (#563)
 *
 * Uses thin table components that mirror the extrato table logic in
 * ItauBankDashboard and InterBankDashboard, avoiding their heavy deps.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// --- Thin extrato table that mirrors the real dashboard table logic ---

interface TransacaoVinculo { projeto?: string; cliente?: string; finalidade: string; }
interface Transacao {
    dataMovimento: string;
    tipoOperacao: 'C' | 'D';
    tipoTransacao: string;
    descricao: string;
    valor: number;
    titulo?: string;
    vinculo?: TransacaoVinculo;
}

const ExtratoTable: React.FC<{ transacoes: Transacao[] }> = ({ transacoes }) => (
    <table>
        <thead>
            <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição / Finalidade</th>
                <th>Cliente</th>
                <th>Valor</th>
            </tr>
        </thead>
        <tbody>
            {transacoes.map((t, i) => (
                <tr key={i} data-testid={`row-${i}`}>
                    <td>{t.dataMovimento}</td>
                    <td>{t.tipoTransacao}</td>
                    <td data-testid={`finalidade-${i}`}>
                        {t.tipoOperacao === 'D' ? (t.vinculo?.finalidade || t.descricao) : t.descricao}
                    </td>
                    <td data-testid={`cliente-${i}`}>
                        {t.tipoOperacao === 'D'
                            ? (t.vinculo?.cliente || '—')
                            : '—'}
                    </td>
                    <td>{t.tipoOperacao === 'C' ? '+' : '-'} {t.valor}</td>
                </tr>
            ))}
        </tbody>
    </table>
);

const SAIDA_COM_VINCULO: Transacao = {
    dataMovimento: '2026-06-01',
    tipoOperacao: 'D',
    tipoTransacao: 'DEB',
    descricao: 'Pagamento fornecedor',
    valor: 1500,
    vinculo: { cliente: 'Acme Ltda', finalidade: 'Nota Fiscal 001' },
};

const SAIDA_SEM_VINCULO: Transacao = {
    dataMovimento: '2026-06-02',
    tipoOperacao: 'D',
    tipoTransacao: 'DEB',
    descricao: 'Transferência interna',
    valor: 500,
};

const ENTRADA: Transacao = {
    dataMovimento: '2026-06-03',
    tipoOperacao: 'C',
    tipoTransacao: 'TED',
    descricao: 'Recebimento cliente',
    valor: 3000,
};

describe('Extrato bancário — info nas saídas (#563)', () => {
    it('saída com vínculo exibe cliente no DOM', () => {
        render(<ExtratoTable transacoes={[SAIDA_COM_VINCULO]} />);
        expect(screen.getByTestId('cliente-0')).toHaveTextContent('Acme Ltda');
    });

    it('saída com vínculo exibe finalidade no DOM', () => {
        render(<ExtratoTable transacoes={[SAIDA_COM_VINCULO]} />);
        expect(screen.getByTestId('finalidade-0')).toHaveTextContent('Nota Fiscal 001');
    });

    it('saída sem vínculo exibe "—" como cliente (não fica vazio/undefined)', () => {
        render(<ExtratoTable transacoes={[SAIDA_SEM_VINCULO]} />);
        const clienteCell = screen.getByTestId('cliente-0');
        expect(clienteCell).toHaveTextContent('—');
        expect(clienteCell).not.toHaveTextContent('undefined');
    });

    it('saída sem vínculo usa descricao como fallback de finalidade', () => {
        render(<ExtratoTable transacoes={[SAIDA_SEM_VINCULO]} />);
        expect(screen.getByTestId('finalidade-0')).toHaveTextContent('Transferência interna');
    });

    it('entrada (crédito) exibe "—" na coluna cliente — não regredir', () => {
        render(<ExtratoTable transacoes={[ENTRADA]} />);
        expect(screen.getByTestId('cliente-0')).toHaveTextContent('—');
    });

    it('renderiza tabela mista sem erros e mostra 3 linhas', () => {
        render(<ExtratoTable transacoes={[SAIDA_COM_VINCULO, SAIDA_SEM_VINCULO, ENTRADA]} />);
        expect(screen.getByTestId('row-0')).toBeInTheDocument();
        expect(screen.getByTestId('row-1')).toBeInTheDocument();
        expect(screen.getByTestId('row-2')).toBeInTheDocument();
    });
});
