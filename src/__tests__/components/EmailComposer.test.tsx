import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../services/aiService', () => ({
    AiService: { analyzeSystem: vi.fn() },
}));

vi.mock('../../services/emailService', () => ({
    EmailService: {
        getUserStore: vi.fn(() => Promise.resolve({ userSettings: null })),
        getTemplates: vi.fn(() => Promise.resolve([])),
        addTemplate: vi.fn(),
    },
}));

vi.mock('../../hooks/usePrompt', () => ({
    usePrompt: () => vi.fn(() => Promise.resolve('')),
}));

import { EmailComposer, isValidEmail } from '../../components/Email/EmailComposer';
import { toast } from 'sonner';

describe('isValidEmail (#832)', () => {
    it('rejeita vazio/whitespace', () => {
        expect(isValidEmail('')).toBe(false);
        expect(isValidEmail('   ')).toBe(false);
    });

    it('rejeita formatos inválidos', () => {
        expect(isValidEmail('nao-e-email')).toBe(false);
        expect(isValidEmail('foo@')).toBe(false);
        expect(isValidEmail('@bar.com')).toBe(false);
        expect(isValidEmail('foo bar@baz.com')).toBe(false);
    });

    it('aceita emails válidos', () => {
        expect(isValidEmail('cliente@exemplo.com')).toBe(true);
        expect(isValidEmail('  user.name@domain.co  ')).toBe(true);
    });
});

describe('EmailComposer — validação de destinatário (#832)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('bloqueia envio sem destinatário e mostra toast de erro', async () => {
        const user = userEvent.setup();
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<EmailComposer onClose={vi.fn()} onSend={onSend} />);

        await user.type(screen.getByPlaceholderText('Assunto'), 'Teste');
        await user.type(screen.getByPlaceholderText('Escreva sua mensagem aqui...'), 'Corpo');

        await user.click(screen.getByRole('button', { name: 'Enviar' }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Informe um destinatário válido em "Para".');
        });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('bloqueia envio com destinatário inválido', async () => {
        const user = userEvent.setup();
        const onSend = vi.fn().mockResolvedValue(undefined);
        render(<EmailComposer onClose={vi.fn()} onSend={onSend} />);

        await user.type(screen.getByPlaceholderText('Para'), 'nao-e-email');
        await user.type(screen.getByPlaceholderText('Assunto'), 'Teste');
        await user.type(screen.getByPlaceholderText('Escreva sua mensagem aqui...'), 'Corpo');

        await user.click(screen.getByRole('button', { name: 'Enviar' }));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalled();
        });
        expect(onSend).not.toHaveBeenCalled();
    });

    it('envia quando o destinatário é válido', async () => {
        const user = userEvent.setup();
        const onSend = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        render(<EmailComposer onClose={onClose} onSend={onSend} />);

        await user.type(screen.getByPlaceholderText('Para'), 'cliente@exemplo.com');
        await user.type(screen.getByPlaceholderText('Assunto'), 'Teste');
        await user.type(screen.getByPlaceholderText('Escreva sua mensagem aqui...'), 'Corpo');

        await user.click(screen.getByRole('button', { name: 'Enviar' }));

        await waitFor(() => {
            expect(onSend).toHaveBeenCalledTimes(1);
        });
        expect(toast.error).not.toHaveBeenCalled();
        expect(onSend).toHaveBeenCalledWith(
            'cliente@exemplo.com',
            'Teste',
            'Corpo',
            [],
            undefined,
            undefined
        );
    });
});
