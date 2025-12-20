import { useMemo } from 'react';
import { WhatsAppConversation, ThirdParty, Invoice, Order, Ticket } from '../types';

export const useCRMContext = (
    selectedConversation: WhatsAppConversation | null,
    customers: ThirdParty[],
    invoices: Invoice[],
    orders: Order[],
    tickets: Ticket[]
) => {
    return useMemo(() => {
        if (!selectedConversation) return null;

        // 1. Try to find customer by name or phone matching
        const customer = customers.find(c => {
            if (!c) return false;
            // Name match (loose)
            const nameMatch = c.name && c.name.toLowerCase().includes(selectedConversation.customerName.toLowerCase());
            // Phone match (clean non-digits)
            const cleanCustPhone = c.phone ? c.phone.replace(/\D/g, '') : '';
            const cleanConvPhone = selectedConversation.customerNumber.replace(/\D/g, '');
            const phoneMatch = cleanCustPhone && cleanConvPhone && (cleanCustPhone.includes(cleanConvPhone) || cleanConvPhone.includes(cleanCustPhone));

            return nameMatch || phoneMatch;
        });

        if (!customer) return null;

        const custInvoices = invoices.filter(i => String(i.socid) === String(customer.id)).slice(0, 5);
        const custOrders = orders.filter(o => String(o.socid) === String(customer.id)).slice(0, 5);
        const custTickets = tickets.filter(t => String(t.socid) === String(customer.id)).slice(0, 5);

        return { customer, invoices: custInvoices, orders: custOrders, tickets: custTickets };
    }, [selectedConversation, customers, invoices, orders, tickets]);
};
