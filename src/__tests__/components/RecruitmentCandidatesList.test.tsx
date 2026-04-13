import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecruitmentCandidatesList } from '../../components/HR/tabs/RecruitmentCandidatesList';
import { Candidate, RecruitmentJobPosition } from '../../types';

describe('RecruitmentCandidatesList', () => {
    const mockOnHireCandidate = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockCandidate = (id: string, firstname: string, lastname: string, fkJobPosition: string, status = 'HIRED'): Candidate => ({
        id,
        fk_job_position: fkJobPosition,
        lastname,
        firstname,
        email: `${firstname.toLowerCase()}@test.com`,
        phone: null,
        phone_mobile: null,
        job: 'Developer',
        skype: null,
        photo: null,
        date_birth: null,
        address: null,
        zip: null,
        town: null,
        fk_department: null,
        fk_country: null,
        entity: 1,
        active: 1,
        status
    });

    const createMockJob = (id: string, label: string): RecruitmentJobPosition => ({
        id,
        label,
        description: 'Test job',
        qty: 1,
        status: '1',
        ref: `JOB-${id}`,
        date_start: Date.now(),
        date_end: null,
        candidateList: [],
        notes: null
    });

    it('renders empty state when no candidates', () => {
        render(
            <RecruitmentCandidatesList
                candidates={[]}
                viewingCandidatesId="ALL"
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('Nenhum candidato encontrado nesta categoria.')).toBeInTheDocument();
    });

    it('renders candidate names', () => {
        const candidates = [
            createMockCandidate('1', 'João', 'Silva', '1'),
            createMockCandidate('2', 'Maria', 'Souza', '1')
        ];
        render(
            <RecruitmentCandidatesList
                candidates={candidates}
                viewingCandidatesId="ALL"
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('João Silva')).toBeInTheDocument();
        expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    });

    it('renders header with Candidatos title', () => {
        render(
            <RecruitmentCandidatesList
                candidates={[createMockCandidate('1', 'João', 'Silva', '1')]}
                viewingCandidatesId="ALL"
                jobPositions={[]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByRole('heading', { name: 'Candidatos' })).toBeInTheDocument();
    });

    it('calls onHireCandidate when hiring a candidate', () => {
        const candidate = createMockCandidate('1', 'João', 'Silva', '1');
        render(
            <RecruitmentCandidatesList
                candidates={[candidate]}
                viewingCandidatesId="ALL"
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        fireEvent.click(screen.getByText('Contratar'));
        expect(mockOnHireCandidate).toHaveBeenCalledWith(candidate);
    });

    it('filters candidates by job position', () => {
        render(
            <RecruitmentCandidatesList
                candidates={[
                    createMockCandidate('1', 'João', 'Silva', '1'),
                    createMockCandidate('2', 'Maria', 'Souza', '2')
                ]}
                viewingCandidatesId="1"
                jobPositions={[
                    createMockJob('1', 'Dev Frontend'),
                    createMockJob('2', 'Dev Backend')
                ]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('João Silva')).toBeInTheDocument();
        expect(screen.queryByText('Maria Souza')).not.toBeInTheDocument();
    });

    it('shows "Todos os Candidatos" when viewing all', () => {
        render(
            <RecruitmentCandidatesList
                candidates={[
                    createMockCandidate('1', 'João', 'Silva', '1'),
                    createMockCandidate('2', 'Maria', 'Souza', '2')
                ]}
                viewingCandidatesId="ALL"
                jobPositions={[
                    createMockJob('1', 'Dev Frontend'),
                    createMockJob('2', 'Dev Backend')
                ]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText(/Todos os Candidatos/)).toBeInTheDocument();
    });

    it('filters candidates by job position', () => {
        render(
            <RecruitmentCandidatesList
                candidates={[
                    createMockCandidate('1', 'João', 'Silva', '1'),
                    createMockCandidate('2', 'Maria', 'Souza', '2')
                ]}
                viewingCandidatesId="1"
                jobPositions={[
                    createMockJob('1', 'Dev Frontend'),
                    createMockJob('2', 'Dev Backend')
                ]}
                onHireCandidate={mockOnHireCandidate}
                onClose={mockOnClose}
            />
        );
        expect(screen.getByText('João Silva')).toBeInTheDocument();
        expect(screen.queryByText('Maria Souza')).not.toBeInTheDocument();
    });
});