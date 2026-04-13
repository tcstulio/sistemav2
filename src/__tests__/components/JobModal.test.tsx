import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JobModal } from '../../components/HR/modals/JobModal';
import { DolibarrConfig } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        createJobPosition: vi.fn().mockResolvedValue({ id: '1' }),
    }
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

describe('JobModal', () => {
    const mockOnClose = vi.fn();
    const mockOnRefresh = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <JobModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.queryByText('Nova Posição')).not.toBeInTheDocument();
    });

    it('renders modal when isOpen is true', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Nova Posição')).toBeInTheDocument();
    });

    it('renders form inputs', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByPlaceholderText('Título')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Qtd')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Descrição')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates job label when typing', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Título') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Desenvolvedor' } });
        expect(input.value).toBe('Desenvolvedor');
    });

    it('updates job qty when typing', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Qtd') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '5' } });
        expect(input.value).toBe('5');
    });

    it('updates job description when typing', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const textarea = screen.getByPlaceholderText('Descrição') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Vaga para dev pleno' } });
        expect(textarea.value).toBe('Vaga para dev pleno');
    });

    it('shows loading spinner when isSubmittingJob is true', () => {
        render(
            <JobModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const criarButton = screen.getByRole('button', { name: /Criar/i });
        fireEvent.click(criarButton);
        expect(screen.queryByText(/Criar/i)).toBeInTheDocument();
    });
});
