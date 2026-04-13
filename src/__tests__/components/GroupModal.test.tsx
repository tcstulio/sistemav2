import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GroupModal } from '../../components/HR/modals/GroupModal';
import { DolibarrConfig, UserGroup } from '../../types';

vi.mock('../../services/api/hrAdmin', () => ({
    createGroup: vi.fn().mockResolvedValue({ id: '1' }),
    updateGroup: vi.fn().mockResolvedValue({ id: '1' }),
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

const mockGroup: UserGroup = {
    id: '1',
    name: 'Grupo Teste',
    note: 'Descrição do grupo'
};

describe('GroupModal', () => {
    const mockOnClose = vi.fn();
    const mockOnRefresh = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        render(
            <GroupModal
                isOpen={false}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.queryByText('Novo Grupo')).not.toBeInTheDocument();
    });

    it('renders "Novo Grupo" when creating new group', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Novo Grupo')).toBeInTheDocument();
    });

    it('renders "Editar Grupo" when editing existing group', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                groupToEdit={mockGroup}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Editar Grupo')).toBeInTheDocument();
    });

    it('renders form with name input', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByPlaceholderText('Ex: Recursos Humanos')).toBeInTheDocument();
    });

    it('renders form with description textarea', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByPlaceholderText('Descrição do propósito deste grupo...')).toBeInTheDocument();
    });

    it('calls onClose when Cancelar button is clicked', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        fireEvent.click(screen.getByText('Cancelar'));
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('updates name when typing', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Ex: Recursos Humanos') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Novo Grupo' } });
        expect(input.value).toBe('Novo Grupo');
    });

    it('updates description when typing', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        const textarea = screen.getByPlaceholderText('Descrição do propósito deste grupo...') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Nova descrição' } });
        expect(textarea.value).toBe('Nova descrição');
    });

    it('shows "Criar Grupo" button text', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Criar Grupo')).toBeInTheDocument();
    });

    it('shows "Salvar Alterações" button text when editing', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                groupToEdit={mockGroup}
                onRefresh={mockOnRefresh}
            />
        );
        expect(screen.getByText('Salvar Alterações')).toBeInTheDocument();
    });

    it('pre-fills form when editing existing group', () => {
        render(
            <GroupModal
                isOpen={true}
                onClose={mockOnClose}
                config={mockConfig}
                groupToEdit={mockGroup}
                onRefresh={mockOnRefresh}
            />
        );
        const input = screen.getByPlaceholderText('Ex: Recursos Humanos') as HTMLInputElement;
        expect(input.value).toBe('Grupo Teste');
    });
});
