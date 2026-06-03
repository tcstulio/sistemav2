import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NewConversationModal } from '../../components/whatsapp/NewConversationModal';
import { WhatsAppAccount } from '../../types';
import { ThirdParty, Contact } from '../../types/crm';

const mockSessions: WhatsAppAccount[] = [
    { id: '1', name: 'Session 1', status: 'connected', phoneNumber: '1199999999', platform: 'WAHA' },
    { id: '2', name: 'Session 2', status: 'disconnected', phoneNumber: '1188888888', platform: 'WAHA' },
];

const mockCustomers: ThirdParty[] = [
    {
        id: '1', name: 'Customer One', status: '1', client: '1', fournisseur: '0', phone: '1199999999', phone_mobile: '',
        email: '', address: '', zip: '', town: '',
    },
];

const mockContacts: Contact[] = [
    {
        id: '1', socid: '1', statut: '1', phone_mobile: '1195555555', firstname: 'John', lastname: 'Doe',
        email: '',
    },
];

describe('NewConversationModal', () => {
    it('renders when isOpen is true', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        expect(document.body.textContent).toBeTruthy();
    });

    it('does not render when isOpen is false', () => {
        render(
            <NewConversationModal
                isOpen={false}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        expect(screen.queryByText('Nova Conversa')).toBeNull();
    });

    it('renders title and description', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        expect(screen.getByText('Nova Conversa')).toBeTruthy();
        expect(screen.getByText(/Envie uma mensagem/)).toBeTruthy();
    });

    it('renders phone tab by default', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        expect(screen.getByText('Numero')).toBeTruthy();
        expect(screen.getByText('Contatos CRM')).toBeTruthy();
    });

    it('renders session selector', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        expect(screen.getByText('Enviar de')).toBeTruthy();
    });

    it('switches to contacts tab', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={mockCustomers}
                contacts={mockContacts}
                suppliers={[]}
                users={[]}
            />
        );
        screen.getByText('Contatos CRM').click();
    });

    it('renders close button', () => {
        render(
            <NewConversationModal
                isOpen={true}
                onClose={() => {}}
                onStartConversation={() => {}}
                sessions={mockSessions}
                selectedSessionId="1"
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
            />
        );
        const closeButton = document.querySelector('.absolute.top-4.right-4');
        expect(closeButton).toBeTruthy();
    });
});
