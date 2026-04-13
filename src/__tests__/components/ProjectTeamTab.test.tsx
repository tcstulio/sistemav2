import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectTeamTab } from '../../components/Projects/tabs/ProjectTeamTab';
import { Project, DolibarrUser } from '../../types';

describe('ProjectTeamTab', () => {
    const createMockProject = (): Project => ({
        id: '1',
        ref: 'PRJ-001',
        title: 'Projeto Teste',
        description: null,
        statu: '1',
        date_c: Date.now(),
        date_start: null,
        date_end: null,
        socid: null,
        public: '0',
        contact_id: null,
        assigned_users: []
    });

    const createMockUser = (id: string, firstname: string, lastname: string): DolibarrUser => ({
        id,
        login: `${firstname.toLowerCase()}.${lastname.toLowerCase()}`,
        lastname,
        firstname,
        email: '',
        photo: undefined,
        entity: 1,
        active: 1
    });

    const createMockContact = (id: string, firstname: string, lastname: string) => ({
        id,
        firstname,
        lastname
    });

    it('renders empty state when team is empty', () => {
        const project = createMockProject();
        render(
            <ProjectTeamTab
                project={project}
                team={[]}
                users={[]}
                contacts={[]}
            />
        );
        expect(screen.getByText('Nenhum membro na equipe.')).toBeInTheDocument();
    });

    it('renders team member name when member is a user', () => {
        const project = createMockProject();
        const users = [createMockUser('1', 'José', 'Silva')];
        const team = [{ id: '1', user_id: '1' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={users}
                contacts={[]}
            />
        );
        expect(screen.getByText('José Silva')).toBeInTheDocument();
    });

    it('renders team member name when member is a contact', () => {
        const project = createMockProject();
        const contacts = [createMockContact('1', 'Maria', 'Souza')];
        const team = [{ id: '1', contact_id: '1' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={[]}
                contacts={contacts}
            />
        );
        expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    });

    it('renders multiple team members', () => {
        const project = createMockProject();
        const users = [
            createMockUser('1', 'José', 'Silva'),
            createMockUser('2', 'Maria', 'Souza')
        ];
        const team = [
            { id: '1', user_id: '1' },
            { id: '2', user_id: '2' }
        ];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={users}
                contacts={[]}
            />
        );
        expect(screen.getByText('José Silva')).toBeInTheDocument();
        expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    });

    it('shows initials in avatar', () => {
        const project = createMockProject();
        const users = [createMockUser('1', 'José', 'Silva')];
        const team = [{ id: '1', user_id: '1' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={users}
                contacts={[]}
            />
        );
        expect(screen.getByText('J')).toBeInTheDocument();
    });

    it('shows type_id when present', () => {
        const project = createMockProject();
        const users = [createMockUser('1', 'José', 'Silva')];
        const team = [{ id: '1', user_id: '1', type_id: 'developer' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={users}
                contacts={[]}
            />
        );
        expect(screen.getByText('developer')).toBeInTheDocument();
    });

    it('renders header "Equipe do Projeto"', () => {
        const project = createMockProject();
        render(
            <ProjectTeamTab
                project={project}
                team={[]}
                users={[]}
                contacts={[]}
            />
        );
        expect(screen.getByText('Equipe do Projeto')).toBeInTheDocument();
    });

    it('shows "Usuário ID" when user not found', () => {
        const project = createMockProject();
        const team = [{ id: '1', user_id: '999' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={[]}
                contacts={[]}
            />
        );
        expect(screen.getByText('Usuário 999')).toBeInTheDocument();
    });

    it('shows "Contato ID" when contact not found', () => {
        const project = createMockProject();
        const team = [{ id: '1', contact_id: '999' }];

        render(
            <ProjectTeamTab
                project={project}
                team={team}
                users={[]}
                contacts={[]}
            />
        );
        expect(screen.getByText('Contato 999')).toBeInTheDocument();
    });
});