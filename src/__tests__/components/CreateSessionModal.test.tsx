import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CreateSessionModal } from '../../components/whatsapp/CreateSessionModal';

describe('CreateSessionModal', () => {
    it('renders when isOpen is true', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('does not render when isOpen is false', () => {
        render(
            <CreateSessionModal
                isOpen={false}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        expect(screen.queryByText('Nova Conta WhatsApp')).toBeNull();
    });

    it('renders title and description', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        expect(screen.getByText('Nova Conta WhatsApp')).toBeTruthy();
        expect(screen.getByText(/identificar esta conta/)).toBeTruthy();
    });

    it('renders name input', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        expect(screen.getByPlaceholderText('Ex: Vendas, Suporte, Financeiro...')).toBeTruthy();
    });

    it('renders submit button', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        expect(screen.getByText('Criar e Conectar')).toBeTruthy();
    });

    it('renders loading state', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
                isLoading={true}
            />
        );
        expect(screen.getByText('Criando...')).toBeTruthy();
    });

    it('has working input field', () => {
        render(
            <CreateSessionModal
                isOpen={true}
                onClose={() => {}}
                onSessionCreated={() => {}}
            />
        );
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input).toBeTruthy();
    });
});
