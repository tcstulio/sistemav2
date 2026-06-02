import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserAvatar } from '../../components/HR/UserAvatar';
import { DolibarrUser, DolibarrConfig } from '../../types';

vi.mock('../../services/dolibarrService', () => ({
    DolibarrService: {
        sanitizeUrl: vi.fn((url: string) => url.replace(/\/$/, ''))
    }
}));

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
    apiKey: 'test-api-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

describe('UserAvatar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockUser: DolibarrUser = {
        id: '1',
        login: 'jose.silva',
        lastname: 'Silva',
        firstname: 'José',
        email: 'jose@coolgroove.com.br',
        photo: 'photo.jpg',
        statut: '1'
    };

    it('renders initials when no photo is provided', () => {
        const userWithoutPhoto: DolibarrUser = { ...mockUser, photo: undefined };
        render(<UserAvatar user={userWithoutPhoto} config={mockConfig} />);
        expect(screen.getByText('JS')).toBeInTheDocument();
    });

    it('renders user initials correctly', () => {
        render(<UserAvatar user={mockUser} config={mockConfig} />);
        expect(screen.getByText('JS')).toBeInTheDocument();
    });

    it('renders img element when photo is provided', () => {
        render(<UserAvatar user={mockUser} config={mockConfig} />);
        const img = screen.getByAltText('jose.silva');
        expect(img).toBeInTheDocument();
    });

    it('handles img load error by showing fallback initials', () => {
        render(<UserAvatar user={mockUser} config={mockConfig} />);
        const img = screen.getByAltText('jose.silva');
        fireEvent.error(img);
        const fallback = screen.getByText('JS');
        expect(fallback).toBeInTheDocument();
    });

    it('applies correct size class for sm', () => {
        const { container } = render(<UserAvatar user={mockUser} config={mockConfig} size="sm" />);
        const avatar = container.querySelector('.w-8');
        expect(avatar).toBeTruthy();
    });

    it('applies correct size class for lg', () => {
        const { container } = render(<UserAvatar user={mockUser} config={mockConfig} size="lg" />);
        const avatar = container.querySelector('.w-24');
        expect(avatar).toBeTruthy();
    });

    it('handles user with only login name', () => {
        const userWithOnlyLogin: DolibarrUser = {
            id: '2',
            login: 'admin',
            lastname: '',
            firstname: '',
            email: 'admin@test.com',
            photo: undefined,
            statut: '1'
        };
        render(<UserAvatar user={userWithOnlyLogin} config={mockConfig} />);
        expect(screen.getByText('A')).toBeInTheDocument();
    });
});