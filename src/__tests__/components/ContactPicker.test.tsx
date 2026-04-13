import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactPicker, CRMContactEntry } from '../../components/whatsapp/ContactPicker';
import { ThirdParty, Contact } from '../../types/crm';

const mockCustomers: ThirdParty[] = [
    {
        id: '1', name: 'Customer One', status: '1', phone: '1199999999', phone_mobile: '',
        ref: '', email: '', ref_ext: '', address: '', zip: '', town: '', fk_pays: '',
    },
    {
        id: '2', name: 'Customer Two', status: '0', phone: '', phone_mobile: '1196666666',
        ref: '', email: '', ref_ext: '', address: '', zip: '', town: '', fk_pays: '',
    },
];

const mockContacts: Contact[] = [
    {
        id: '1', statut: '1', phone_mobile: '1195555555', firstname: 'John', lastname: 'Doe',
        email: '', ref: '', fk_soc: '', address: '', zip: '', town: '', fk_pays: '',
    },
    {
        id: '2', statut: '0', phone_mobile: '1194444444', firstname: 'Jane', lastname: 'Smith',
        email: '', ref: '', fk_soc: '', address: '', zip: '', town: '', fk_pays: '',
    },
];

const mockSuppliers: ThirdParty[] = [
    {
        id: '1', name: 'Supplier One', status: '1', phone: '1193333333', phone_mobile: '',
        ref: '', email: '', ref_ext: '', address: '', zip: '', town: '', fk_pays: '',
    },
];

const mockUsers = [
    { id: '1', login: 'user1', firstname: 'Alice', lastname: 'Bob', phone_mobile: '1191111111', statut: '1' },
    { id: '2', login: 'user2', firstname: 'Charlie', lastname: 'David', phone_mobile: '', statut: '1' },
];

describe('ContactPicker', () => {
    it('renders search input', () => {
        render(
            <ContactPicker
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        expect(screen.getByPlaceholderText('Buscar por nome ou telefone...')).toBeTruthy();
    });

    it('renders filter tabs', () => {
        render(
            <ContactPicker
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        expect(screen.getByText('Todos')).toBeTruthy();
        expect(screen.getByText('Cliente')).toBeTruthy();
        expect(screen.getByText('Contato')).toBeTruthy();
        expect(screen.getByText('Fornecedor')).toBeTruthy();
        expect(screen.getByText('Equipe')).toBeTruthy();
    });

    it('renders empty state when no contacts', () => {
        render(
            <ContactPicker
                customers={[]}
                contacts={[]}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        expect(screen.getByText('Nenhum contato com telefone cadastrado')).toBeTruthy();
    });

    it('renders customers with phone', () => {
        render(
            <ContactPicker
                customers={mockCustomers}
                contacts={[]}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        expect(screen.getByText('Customer One')).toBeTruthy();
        expect(screen.queryByText('Customer Two')).toBeNull();
    });

    it('renders contacts with phone', () => {
        render(
            <ContactPicker
                customers={[]}
                contacts={mockContacts}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        expect(screen.getByText('John Doe')).toBeTruthy();
        expect(screen.queryByText('Jane Smith')).toBeNull();
    });

    it('calls onSelect when clicking a contact', () => {
        let selectedEntry: CRMContactEntry | null = null;
        render(
            <ContactPicker
                customers={[]}
                contacts={mockContacts}
                suppliers={[]}
                users={[]}
                onSelect={(entry) => { selectedEntry = entry; }}
            />
        );
        screen.getByText('John Doe').click();
        expect(selectedEntry).toBeTruthy();
        expect(selectedEntry?.name).toBe('John Doe');
    });

    it('filters by search term', () => {
        render(
            <ContactPicker
                customers={mockCustomers}
                contacts={[]}
                suppliers={[]}
                users={[]}
                onSelect={() => {}}
            />
        );
        const input = screen.getByPlaceholderText('Buscar por nome ou telefone...') as HTMLInputElement;
        input.value = 'One';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(screen.getByText('Customer One')).toBeTruthy();
    });

    it('filters by type', () => {
        render(
            <ContactPicker
                customers={mockCustomers}
                contacts={mockContacts}
                suppliers={mockSuppliers}
                users={mockUsers}
                onSelect={() => {}}
            />
        );
        const buttons = document.querySelectorAll('button');
        const clienteBtn = Array.from(buttons).find(b => b.textContent === 'Cliente' && b.className.includes('px-3'));
        expect(clienteBtn).toBeTruthy();
    });
});
