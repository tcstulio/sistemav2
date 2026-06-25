import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { UserAvatar } from '../../components/HR/UserAvatar';
import { DolibarrUser, DolibarrConfig } from '../../types';

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
    apiKey: 'test-api-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any,
};

const mockUser: DolibarrUser = {
    id: '1',
    login: 'jose.silva',
    lastname: 'Silva',
    firstname: 'José',
    email: 'jose@coolgroove.com.br',
    photo: 'photo.jpg',
    statut: '1',
};

describe('UserAvatar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // jsdom não implementa URL.createObjectURL/revokeObjectURL — mockamos manualmente.
        (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
        (globalThis.URL as any).revokeObjectURL = vi.fn();
        // Por padrão, simula 404 (sem foto). Testes que precisam de imagem sobrescrevem.
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 404,
            blob: () => Promise.resolve(new Blob()),
        } as any);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders initials when no photo is provided', () => {
        const userWithoutPhoto: DolibarrUser = { ...mockUser, photo: undefined };
        render(<UserAvatar user={userWithoutPhoto} config={mockConfig} />);
        expect(screen.getByText('JS')).toBeInTheDocument();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('renders user initials correctly (fallback base)', () => {
        render(<UserAvatar user={{ ...mockUser, photo: undefined }} config={mockConfig} />);
        expect(screen.getByText('JS')).toBeInTheDocument();
    });

    it('renders the photo img when fetch resolves with an image blob', async () => {
        const blob = new Blob(['img-bytes'], { type: 'image/jpeg' });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            blob: () => Promise.resolve(blob),
        } as any);

        render(<UserAvatar user={mockUser} config={mockConfig} />);
        const img = await screen.findByAltText('jose.silva');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'blob:mock-url');
    });

    it('shows fallback initials (no <img>) when photo returns 404 — no console error', async () => {
        render(<UserAvatar user={mockUser} config={mockConfig} />);
        await waitFor(() => {
            expect(screen.getByText('JS')).toBeInTheDocument();
        });
        // Nenhum <img> é renderizado, então o navegador não loga "Failed to load resource: 404".
        expect(document.querySelector('img')).toBeNull();
    });

    it('shows fallback initials when fetch rejects (network error)', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));

        render(<UserAvatar user={mockUser} config={mockConfig} />);
        await waitFor(() => {
            expect(screen.getByText('JS')).toBeInTheDocument();
        });
        expect(document.querySelector('img')).toBeNull();
    });

    it('falls back to initials if the img fails to load after a successful fetch', async () => {
        const blob = new Blob(['img'], { type: 'image/jpeg' });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            blob: () => Promise.resolve(blob),
        } as any);

        render(<UserAvatar user={mockUser} config={mockConfig} />);
        const img = await screen.findByAltText('jose.silva');
        img.dispatchEvent(new Event('error'));
        await waitFor(() => {
            expect(screen.getByText('JS')).toBeInTheDocument();
        });
        expect(document.querySelector('img')).toBeNull();
    });

    it('applies correct size class for sm', () => {
        const { container } = render(<UserAvatar user={{ ...mockUser, photo: undefined }} config={mockConfig} size="sm" />);
        expect(container.querySelector('.w-8')).toBeTruthy();
    });

    it('applies correct size class for lg', () => {
        const { container } = render(<UserAvatar user={{ ...mockUser, photo: undefined }} config={mockConfig} size="lg" />);
        expect(container.querySelector('.w-24')).toBeTruthy();
    });

    it('handles user with only login name', () => {
        const userWithOnlyLogin: DolibarrUser = {
            id: '2',
            login: 'admin',
            lastname: '',
            firstname: '',
            email: 'admin@test.com',
            photo: undefined,
            statut: '1',
        };
        render(<UserAvatar user={userWithOnlyLogin} config={mockConfig} />);
        expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('uses each user own id+photo — no cross-user swapping (olga.png case)', async () => {
        const blob = new Blob(['img'], { type: 'image/jpeg' });
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            blob: () => Promise.resolve(blob),
        } as any);

        // O mesmo nome de arquivo (olga.png) aparece para userIds distintos — cada avatar deve
        // pedir a foto do SEU próprio userId, sem trocar entre usuários. (#824)
        const user35 = { ...mockUser, id: '35', login: 'user35', photo: 'olga.png' };
        const user32 = { ...mockUser, id: '32', login: 'user32', photo: 'olga.png' };

        render(<UserAvatar user={user35} config={mockConfig} />);
        render(<UserAvatar user={user32} config={mockConfig} />);

        await screen.findByAltText('user35');
        await screen.findByAltText('user32');

        const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((u) => u.includes('userId=35&file=olga.png'))).toBe(true);
        expect(calls.some((u) => u.includes('userId=32&file=olga.png'))).toBe(true);
    });
});
