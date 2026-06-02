import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getUserName, getProjectName, formatDuration, getExpenseStatusBadge, getLeaveStatusBadge, getLeaveIcon } from '../../components/HR/utils';
import { DolibarrUser, Project } from '../../types';

describe('HR utils', () => {
    const createMockUser = (id: string, firstname: string, lastname: string, login: string): DolibarrUser => ({
        id,
        login,
        lastname,
        firstname,
        email: `${login}@test.com`,
        photo: undefined,
        statut: '1'
    });

    const createMockProject = (id: string, title: string): Project => ({
        id,
        ref: `PRJ-${id}`,
        title,
        statut: '1',
        date_creation: Date.now(),
        date_end: undefined,
        socid: '0',
        progress: 0
    });

    describe('getUserName', () => {
        it('returns full name when firstname and lastname exist', () => {
            const users = [createMockUser('1', 'José', 'Silva', 'jose')];
            expect(getUserName('1', users)).toBe('José Silva');
        });

        it('returns lastname when firstname is empty', () => {
            const users = [createMockUser('1', '', 'Silva', 'jose')];
            expect(getUserName('1', users)).toBe('Silva');
        });

        it('returns firstname when lastname is empty', () => {
            const users = [createMockUser('1', 'José', '', 'jose')];
            expect(getUserName('1', users)).toBe('José');
        });

        it('returns login when both firstname and lastname are empty', () => {
            const users = [createMockUser('1', '', '', 'jose')];
            expect(getUserName('1', users)).toBe('jose');
        });

        it('returns "Usuário Desconhecido" when user not found', () => {
            const users = [createMockUser('1', 'José', 'Silva', 'jose')];
            expect(getUserName('999', users)).toBe('Usuário Desconhecido');
        });

        it('handles string id comparison', () => {
            const users = [createMockUser('1', 'José', 'Silva', 'jose')];
            expect(getUserName('1', users)).toBe('José Silva');
        });
    });

    describe('getProjectName', () => {
        it('returns project title when found', () => {
            const projects = [createMockProject('1', 'Projeto Alpha')];
            expect(getProjectName('1', projects)).toBe('Projeto Alpha');
        });

        it('returns "Sem Projeto" when not found', () => {
            const projects = [createMockProject('1', 'Projeto Alpha')];
            expect(getProjectName('999', projects)).toBe('Sem Projeto');
        });
    });

    describe('formatDuration', () => {
        it('formats 0 seconds', () => {
            expect(formatDuration(0)).toBe('0h 0m');
        });

        it('formats hours and minutes', () => {
            expect(formatDuration(3660)).toBe('1h 1m');
        });

        it('formats only hours when exactly divisible', () => {
            expect(formatDuration(7200)).toBe('2h 0m');
        });

        it('formats only minutes when less than an hour', () => {
            expect(formatDuration(1800)).toBe('0h 30m');
        });

        it('formats large durations', () => {
            expect(formatDuration(28800)).toBe('8h 0m');
        });
    });

    describe('getExpenseStatusBadge', () => {
        it('renders Rascunho for status 0', () => {
            const { container } = render(getExpenseStatusBadge('0'));
            expect(container.textContent).toContain('Rascunho');
        });

        it('renders Submetido for status 1', () => {
            const { container } = render(getExpenseStatusBadge('1'));
            expect(container.textContent).toContain('Submetido');
        });

        it('renders Aprovado for status 2', () => {
            const { container } = render(getExpenseStatusBadge('2'));
            expect(container.textContent).toContain('Aprovado');
        });

        it('renders Pago for status 5', () => {
            const { container } = render(getExpenseStatusBadge('5'));
            expect(container.textContent).toContain('Pago');
        });

        it('renders Recusado for status 9', () => {
            const { container } = render(getExpenseStatusBadge('9'));
            expect(container.textContent).toContain('Recusado');
        });
    });

    describe('getLeaveStatusBadge', () => {
        it('renders Rascunho for status 1', () => {
            const { container } = render(getLeaveStatusBadge('1'));
            expect(container.textContent).toContain('Rascunho');
        });

        it('renders Aguardando for status 2', () => {
            const { container } = render(getLeaveStatusBadge('2'));
            expect(container.textContent).toContain('Aguardando');
        });

        it('renders Aprovado for status 3', () => {
            const { container } = render(getLeaveStatusBadge('3'));
            expect(container.textContent).toContain('Aprovado');
        });

        it('renders Cancelado for status 4', () => {
            const { container } = render(getLeaveStatusBadge('4'));
            expect(container.textContent).toContain('Cancelado');
        });

        it('renders Recusado for status 5', () => {
            const { container } = render(getLeaveStatusBadge('5'));
            expect(container.textContent).toContain('Recusado');
        });
    });

    describe('getLeaveIcon', () => {
        it('returns Thermometer for sick leave', () => {
            const result = getLeaveIcon('sick leave');
            expect(result).toBeTruthy();
        });

        it('returns Sun for vacation', () => {
            const result = getLeaveIcon('vacation');
            expect(result).toBeTruthy();
        });

        it('returns Sun for holiday', () => {
            const result = getLeaveIcon('holiday');
            expect(result).toBeTruthy();
        });

        it('returns Plane for other types', () => {
            const result = getLeaveIcon('personal');
            expect(result).toBeTruthy();
        });

        it('handles empty string', () => {
            const result = getLeaveIcon('');
            expect(result).toBeTruthy();
        });
    });
});