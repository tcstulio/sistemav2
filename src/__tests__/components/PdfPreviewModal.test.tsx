import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PdfPreviewModal } from '../../components/common/PdfPreviewModal';

// Mock getDocumentBlob and downloadDocument from core
const mockGetDocumentBlob = vi.fn();
const mockDownloadDocument = vi.fn();

vi.mock('../../services/api/core', () => ({
    getDocumentBlob: (...args: any[]) => mockGetDocumentBlob(...args),
    downloadDocument: (...args: any[]) => mockDownloadDocument(...args),
}));

// Mock URL object methods
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-blob');
const mockRevokeObjectURL = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });
});

describe('PdfPreviewModal', () => {
    const baseProps = {
        entityType: 'invoice',
        entityId: '42',
        title: 'FA2501-0042',
        isOpen: true,
        onClose: vi.fn(),
    };

    it('calls getDocumentBlob when isOpen becomes true', async () => {
        const blob = new Blob(['%PDF'], { type: 'application/pdf' });
        mockGetDocumentBlob.mockResolvedValueOnce(blob);

        render(<PdfPreviewModal {...baseProps} />);

        await waitFor(() => {
            expect(mockGetDocumentBlob).toHaveBeenCalledWith('invoice', '42');
        });
    });

    it('renders iframe with object URL after blob is loaded', async () => {
        const blob = new Blob(['%PDF'], { type: 'application/pdf' });
        mockGetDocumentBlob.mockResolvedValueOnce(blob);

        render(<PdfPreviewModal {...baseProps} />);

        await waitFor(() => {
            const iframe = document.querySelector('iframe');
            expect(iframe).toBeTruthy();
            expect(iframe?.src).toContain('blob:');
        });
    });

    it('shows loading state while fetching', async () => {
        // Never resolve to keep loading state visible
        mockGetDocumentBlob.mockReturnValueOnce(new Promise(() => {}));

        render(<PdfPreviewModal {...baseProps} />);

        expect(screen.getByText('Carregando PDF...')).toBeTruthy();
    });

    it('shows error message when getDocumentBlob throws', async () => {
        mockGetDocumentBlob.mockRejectedValueOnce(new Error('PDF não disponível para este documento'));

        render(<PdfPreviewModal {...baseProps} />);

        await waitFor(() => {
            expect(screen.getByText('PDF não disponível para este documento')).toBeTruthy();
        });
    });

    it('calls downloadDocument with correct args when Baixar is clicked', async () => {
        const blob = new Blob(['%PDF'], { type: 'application/pdf' });
        mockGetDocumentBlob.mockResolvedValueOnce(blob);
        mockDownloadDocument.mockResolvedValueOnce(undefined);

        render(<PdfPreviewModal {...baseProps} />);

        // Wait for modal to render the download button
        await waitFor(() => screen.getByText('Baixar'));
        fireEvent.click(screen.getByText('Baixar'));

        expect(mockDownloadDocument).toHaveBeenCalledWith('invoice', '42');
    });

    it('does not call getDocumentBlob when isOpen is false', () => {
        render(<PdfPreviewModal {...baseProps} isOpen={false} />);
        expect(mockGetDocumentBlob).not.toHaveBeenCalled();
    });

    it('does not render when isOpen is false', () => {
        render(<PdfPreviewModal {...baseProps} isOpen={false} />);
        expect(screen.queryByText('Carregando PDF...')).toBeNull();
    });
});
