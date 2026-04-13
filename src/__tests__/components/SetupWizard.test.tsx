import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SetupWizard from '../../components/SetupWizard';
import { DolibarrConfig } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        sanitizeUrl: vi.fn((url: string) => url.replace(/\/$/, '')),
        login: vi.fn(),
        checkConnection: vi.fn()
    }
}));

import { DolibarrService } from '../../services/dolibarrService';

describe('SetupWizard', () => {
    const mockOnComplete = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetAllMocks();
    });

    it('renders the wizard with branding', () => {
        render(<SetupWizard onComplete={mockOnComplete} />);
        expect(screen.getByRole('heading', { name: 'CoolGroove' })).toBeInTheDocument();
        expect(screen.getByText('Painel de Gestão')).toBeInTheDocument();
    });

    it('renders login form', () => {
        render(<SetupWizard onComplete={mockOnComplete} />);
        expect(screen.getByText('Conectar')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('ex: admin')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    });

    it('shows validation error when fields are empty', async () => {
        render(<SetupWizard onComplete={mockOnComplete} />);
        fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

        await waitFor(() => {
            expect(DolibarrService.login).not.toHaveBeenCalled();
        });
    });

    it('calls onComplete with config after successful login', async () => {
        (DolibarrService.login as any).mockResolvedValue({ apiKey: 'test-key', user: { id: '1' } });
        (DolibarrService.checkConnection as any).mockResolvedValue(true);

        render(<SetupWizard onComplete={mockOnComplete} />);

        fireEvent.change(screen.getByPlaceholderText('ex: admin'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

        await waitFor(() => {
            expect(mockOnComplete).toHaveBeenCalledWith(expect.objectContaining({
                apiKey: 'test-key',
                themeColor: 'indigo'
            }));
        });
    });

    it('shows error message on login failure', async () => {
        (DolibarrService.login as any).mockRejectedValue(new Error('Credenciais inválidas'));

        render(<SetupWizard onComplete={mockOnComplete} />);

        fireEvent.change(screen.getByPlaceholderText('ex: admin'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrongpassword' } });
        fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

        await waitFor(() => {
            expect(screen.getByText('Falha no Login')).toBeInTheDocument();
        });
    });

    it('shows loading state during authentication', async () => {
        (DolibarrService.login as any).mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

        render(<SetupWizard onComplete={mockOnComplete} />);

        fireEvent.change(screen.getByPlaceholderText('ex: admin'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password' } });
        fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

        expect(screen.getByText('Autenticando...')).toBeInTheDocument();
    });
});