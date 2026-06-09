import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDolibarrLink } from '../../hooks/useDolibarrLink';
import { DolibarrConfig } from '../../types';

describe('useDolibarrLink', () => {
    const mockConfig: DolibarrConfig = {
        apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
        apiKey: 'test-api-key',
        themeColor: 'indigo',
        darkMode: false,
        apiLimit: 0,
        currentUser: {} as any
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns # when config is null', () => {
        const { result } = renderHook(() => useDolibarrLink(null));
        expect(result.current.getLink('invoice', '123')).toBe('#');
    });

    it('returns # when id is empty', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('invoice', '')).toBe('#');
    });

    it('generates correct invoice link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('invoice', '123')).toBe('https://sistema.coolgroove.com.br/compta/facture/card.php?facid=123');
    });

    it('generates correct proposal link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('proposal', '456')).toBe('https://sistema.coolgroove.com.br/comm/propal/card.php?id=456');
    });

    it('generates correct order link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('order', '789')).toBe('https://sistema.coolgroove.com.br/commande/card.php?id=789');
    });

    it('generates correct project link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('project', '100')).toBe('https://sistema.coolgroove.com.br/projet/card.php?id=100');
    });

    it('generates correct customer link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('customer', '200')).toBe('https://sistema.coolgroove.com.br/societe/card.php?socid=200');
    });

    it('generates correct product link', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('product', '300')).toBe('https://sistema.coolgroove.com.br/product/card.php?id=300');
    });

    it('generates correct ticket link with ref', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('ticket', '400', 'REF123')).toBe('https://sistema.coolgroove.com.br/ticket/card.php?track_id=REF123&id=400');
    });

    it('returns # for unknown module type', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('unknown', '123')).toBe('#');
    });

    it('gera o link da tarefa com apiUrl absoluta', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('task', '100')).toBe('https://sistema.coolgroove.com.br/projet/tasks/task.php?id=100&withproject=1');
    });

    it('usa o fallback (sistema.coolgroove.com.br) quando apiUrl é proxy/relativa', () => {
        const proxyConfig = { ...mockConfig, apiUrl: '/api/dolibarr' } as DolibarrConfig;
        const { result } = renderHook(() => useDolibarrLink(proxyConfig));
        expect(result.current.getLink('task', '100')).toBe('https://sistema.coolgroove.com.br/projet/tasks/task.php?id=100&withproject=1');
        expect(result.current.getLink('project', '5')).toBe('https://sistema.coolgroove.com.br/projet/card.php?id=5');
    });

    it('usa o fallback quando apiUrl está vazia', () => {
        const emptyConfig = { ...mockConfig, apiUrl: '' } as DolibarrConfig;
        const { result } = renderHook(() => useDolibarrLink(emptyConfig));
        expect(result.current.getLink('invoice', '9')).toBe('https://sistema.coolgroove.com.br/compta/facture/card.php?facid=9');
    });

    it('handles alternative module names (commande)', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('commande', '999')).toBe('https://sistema.coolgroove.com.br/commande/card.php?id=999');
    });

    it('handles alternative module names (facture)', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('facture', '111')).toBe('https://sistema.coolgroove.com.br/compta/facture/card.php?facid=111');
    });

    it('handles alternative module names (societe)', () => {
        const { result } = renderHook(() => useDolibarrLink(mockConfig));
        expect(result.current.getLink('societe', '222')).toBe('https://sistema.coolgroove.com.br/societe/card.php?socid=222');
    });
});