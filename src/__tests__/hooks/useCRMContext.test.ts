import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCRMContext } from '../../hooks/useCRMContext';
import { WhatsAppConversation, ThirdParty, Invoice, Order, Ticket } from '../../types';

describe('useCRMContext', () => {
    const createMockConversation = (customerName: string, customerNumber: string): WhatsAppConversation => ({
        id: 'conv-1',
        accountId: 'acc-1',
        customerName,
        customerNumber,
        lastMessage: 'Hello',
        lastMessageTimestamp: Date.now(),
        unreadCount: 0,
        status: 'open'
    });

    const createMockCustomer = (id: string, name: string, phone?: string): ThirdParty => ({
        id,
        name,
        phone: phone || undefined,
        phone_mobile: undefined,
        email: undefined,
        address: undefined,
        zip: undefined,
        town: undefined,
        status: '1',
        client: '1',
        fournisseur: '0'
    });

    it('returns null when no conversation selected', () => {
        const { result } = renderHook(() => useCRMContext(null, [], [], [], []));
        expect(result.current).toBeNull();
    });

    it('returns null when no customer matches', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'Jane Smith', '5511888888888')];
        const { result } = renderHook(() => useCRMContext(conversation, customers, [], [], []));
        expect(result.current).toBeNull();
    });

    it('finds customer by name match', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John Doe', '5511888888888')];
        const { result } = renderHook(() => useCRMContext(conversation, customers, [], [], []));
        expect(result.current).not.toBeNull();
        expect(result.current?.customer.id).toBe('1');
    });

    it('finds customer by phone match', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John', '11999999999')];
        const { result } = renderHook(() => useCRMContext(conversation, customers, [], [], []));
        expect(result.current).not.toBeNull();
        expect(result.current?.customer.id).toBe('1');
    });

    it('returns related invoices for matched customer', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John Doe')];
        const invoices = [
            { id: '1', socid: '1', ref: 'INV-001', date: 0, total_ttc: 100 } as Invoice,
            { id: '2', socid: '2', ref: 'INV-002', date: 0, total_ttc: 200 } as Invoice
        ];
        const { result } = renderHook(() => useCRMContext(conversation, customers, invoices, [], []));
        expect(result.current?.invoices).toHaveLength(1);
        expect(result.current?.invoices[0].ref).toBe('INV-001');
    });

    it('returns related orders for matched customer', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John Doe')];
        const orders = [
            { id: '1', socid: '1', ref: 'ORD-001', date: 0, total_ttc: 100 } as Order,
            { id: '2', socid: '2', ref: 'ORD-002', date: 0, total_ttc: 200 } as Order
        ];
        const { result } = renderHook(() => useCRMContext(conversation, customers, [], orders, []));
        expect(result.current?.orders).toHaveLength(1);
        expect(result.current?.orders[0].ref).toBe('ORD-001');
    });

    it('returns related tickets for matched customer', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John Doe')];
        const tickets = [
            { id: '1', socid: '1', ref: 'TKT-001', datec: 0, subject: 'Issue 1' } as Ticket,
            { id: '2', socid: '2', ref: 'TKT-002', datec: 0, subject: 'Issue 2' } as Ticket
        ];
        const { result } = renderHook(() => useCRMContext(conversation, customers, [], [], tickets));
        expect(result.current?.tickets).toHaveLength(1);
        expect(result.current?.tickets[0].ref).toBe('TKT-001');
    });

    it('limits invoices to 5', () => {
        const conversation = createMockConversation('John Doe', '5511999999999');
        const customers = [createMockCustomer('1', 'John Doe')];
        const invoices = Array.from({ length: 10 }, (_, i) => ({
            id: String(i + 1),
            socid: '1',
            ref: `INV-${i + 1}`,
            date: 0,
            total_ttc: 100
        } as Invoice));
        const { result } = renderHook(() => useCRMContext(conversation, customers, invoices, [], []));
        expect(result.current?.invoices).toHaveLength(5);
    });
});