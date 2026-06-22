import { useMemo } from 'react';
import { WhatsAppConversation, ThirdParty, Invoice, Order, Ticket } from '../types';
import { Project } from '../types/projects';

export const useCRMContext = (
    selectedConversation: WhatsAppConversation | null,
    customers: ThirdParty[],
    invoices: Invoice[],
    orders: Order[],
    tickets: Ticket[],
    projects: Project[] = []
) => {
    return useMemo(() => {
        if (!selectedConversation) return null;

        // 1. If the conversation has a manually linked customer_id, use it directly
        let customer: ThirdParty | undefined;
        if (selectedConversation.customer_id) {
            customer = customers.find(c => String(c.id) === String(selectedConversation.customer_id));
        }

        // 2. Fallback: try to find customer by name or phone matching
        if (!customer) {
            customer = customers.find(c => {
                if (!c) return false;
                // Name match (loose)
                const nameMatch = c.name && c.name.toLowerCase().includes(selectedConversation.customerName.toLowerCase());
                // Phone match (clean non-digits)
                const cleanCustPhone = c.phone ? c.phone.replace(/\D/g, '') : '';
                const cleanConvPhone = selectedConversation.customerNumber.replace(/\D/g, '');
                const phoneMatch = cleanCustPhone && cleanConvPhone && (cleanCustPhone.includes(cleanConvPhone) || cleanConvPhone.includes(cleanCustPhone));

                return nameMatch || phoneMatch;
            });
        }

        if (!customer) return null;

        const custInvoices = invoices.filter(i => String(i.socid) === String(customer!.id)).slice(0, 5);
        const custOrders = orders.filter(o => String(o.socid) === String(customer!.id)).slice(0, 5);
        const custTickets = tickets.filter(t => String(t.socid) === String(customer!.id)).slice(0, 5);
        const custProjects = projects.filter(p => String(p.socid) === String(customer!.id) && p.statut !== '2').slice(0, 3);

        return { customer, invoices: custInvoices, orders: custOrders, tickets: custTickets, projects: custProjects };
    }, [selectedConversation, customers, invoices, orders, tickets, projects]);
};
