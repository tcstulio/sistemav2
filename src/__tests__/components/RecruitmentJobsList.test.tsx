import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecruitmentJobsList } from '../../components/HR/tabs/RecruitmentJobsList';
import { RecruitmentJobPosition, Candidate, DolibarrConfig } from '../../types';

const mockConfig: DolibarrConfig = {
    apiUrl: 'https://sistema.coolgroove.com.br/api/index.php',
    apiKey: 'test-api-key',
    themeColor: 'indigo',
    darkMode: false,
    apiLimit: 0,
    currentUser: {} as any
};

describe('RecruitmentJobsList', () => {
    const mockOnViewCandidates = vi.fn();
    const mockOnOpenJobModal = vi.fn();
    const mockSetDisplayLimit = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const createMockJob = (id: string, label: string, description?: string, qty = 1, status = '1'): RecruitmentJobPosition => ({
        id,
        label,
        description,
        qty,
        status,
        ref: `JOB-${id}`,
        date_start: Date.now(),
        date_end: null,
        candidateList: [],
        notes: null
    });

    const createMockCandidate = (id: string, fkJobPosition: string): Candidate => ({
        id,
        fk_job_position: fkJobPosition,
        lastname: 'Silva',
        firstname: 'João',
        email: `joao${id}@test.com`,
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
        active: 1
    });

    it('renders empty state when no jobs', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[]}
                candidates={[]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Nenhuma vaga encontrada.')).toBeInTheDocument();
    });

    it('renders "Ver Todos os Candidatos" button', () => {
        const candidates = [createMockCandidate('1', '1')];
        render(
            <RecruitmentJobsList
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                candidates={candidates}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Ver Todos os Candidatos')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('filters jobs by search term', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[
                    createMockJob('1', 'Dev Frontend'),
                    createMockJob('2', 'Dev Backend')
                ]}
                candidates={[]}
                searchTerm="frontend"
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Dev Frontend')).toBeInTheDocument();
        expect(screen.queryByText('Dev Backend')).not.toBeInTheDocument();
    });

    it('calls onViewCandidates when clicking a job', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                candidates={[]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        fireEvent.click(screen.getByText('Dev Frontend'));
        expect(mockOnViewCandidates).toHaveBeenCalledWith('1');
    });

    it('calls onViewCandidates with ALL when clicking "Ver Todos"', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                candidates={[createMockCandidate('1', '1')]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        fireEvent.click(screen.getByText('Ver Todos os Candidatos'));
        expect(mockOnViewCandidates).toHaveBeenCalledWith('ALL');
    });

    it('shows load more button when there are more jobs', () => {
        const jobs = Array.from({ length: 60 }, (_, i) => createMockJob(String(i + 1), `Job ${i + 1}`));
        render(
            <RecruitmentJobsList
                jobPositions={jobs}
                candidates={[]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Carregar Mais')).toBeInTheDocument();
    });

    it('renders job status correctly', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[
                    createMockJob('1', 'Dev Aberto', 'Description', 1, '1'),
                    createMockJob('2', 'Dev Rascunho', 'Description', 1, '0')
                ]}
                candidates={[]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText('Aberto')).toBeInTheDocument();
        expect(screen.getByText('Rascunho')).toBeInTheDocument();
    });

    it('displays candidate count for each job', () => {
        render(
            <RecruitmentJobsList
                jobPositions={[createMockJob('1', 'Dev Frontend')]}
                candidates={[
                    createMockCandidate('1', '1'),
                    createMockCandidate('2', '1'),
                    createMockCandidate('3', '2')
                ]}
                searchTerm=""
                sortConfig={{ key: 'default', direction: 'asc' }}
                displayLimit={50}
                viewingCandidatesId={null}
                config={mockConfig}
                onViewCandidates={mockOnViewCandidates}
                onOpenJobModal={mockOnOpenJobModal}
                setDisplayLimit={mockSetDisplayLimit}
            />
        );
        expect(screen.getByText(/2 Candidatos/)).toBeInTheDocument();
    });
});