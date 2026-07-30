import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AttachmentPreview } from '../../components/chat/AttachmentPreview';

describe('AttachmentPreview', () => {
    beforeEach(() => {
        Object.defineProperty(URL, 'createObjectURL', {
            value: vi.fn(() => 'blob:attachment-preview'),
            configurable: true,
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            value: vi.fn(),
            configurable: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('exibe pré-visualização, nome e tamanho de imagem', () => {
        const file = new File([new Uint8Array(2048)], 'foto.png', { type: 'image/png' });

        render(<AttachmentPreview file={file} onRemove={vi.fn()} />);

        expect(screen.getByRole('img', { name: 'Pré-visualização de foto.png' })).toHaveAttribute('src', 'blob:attachment-preview');
        expect(screen.getByText('foto.png')).toBeInTheDocument();
        expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    });

    it('exibe vídeo local com texto alternativo e controles de play/pause', () => {
        const file = new File(['video'], 'curto.webm', { type: 'video/webm' });

        render(<AttachmentPreview file={file} onRemove={vi.fn()} />);

        const video = screen.getByLabelText('Pré-visualização do vídeo curto.webm');
        expect(video).toHaveAttribute('src', 'blob:attachment-preview');
        expect(video).toHaveAttribute('controls');
        expect(screen.getByText('curto.webm')).toBeInTheDocument();
        expect(screen.getByText('5 B')).toBeInTheDocument();
    });

    it('gera thumbnail do vídeo localmente com video e canvas', async () => {
        const originalCreateElement = document.createElement.bind(document);
        const createdVideos: HTMLVideoElement[] = [];
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
            const element = originalCreateElement(tagName, options);
            if (tagName === 'video') createdVideos.push(element as HTMLVideoElement);
            return element;
        });
        const drawImage = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
        vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,thumbnail');
        const file = new File(['video'], 'curto.mp4', { type: 'video/mp4' });

        render(<AttachmentPreview file={file} onRemove={vi.fn()} />);
        expect(createdVideos).toHaveLength(2);
        const thumbnailVideo = createdVideos.find((video) => !video.isConnected);
        expect(thumbnailVideo).toBeDefined();
        Object.defineProperties(thumbnailVideo!, {
            videoWidth: { value: 320 },
            videoHeight: { value: 180 },
            duration: { value: 0 },
        });
        fireEvent(thumbnailVideo!, new Event('loadeddata'));

        await waitFor(() => {
            expect(drawImage).toHaveBeenCalled();
            expect(screen.getByLabelText('Pré-visualização do vídeo curto.mp4')).toHaveAttribute('poster', 'data:image/jpeg;base64,thumbnail');
        });
    });

    it('exibe PDF e permite removê-lo', () => {
        const onRemove = vi.fn();
        const file = new File(['pdf'], 'manual.pdf', { type: 'application/pdf' });

        render(<AttachmentPreview file={file} onRemove={onRemove} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remover manual.pdf' }));

        expect(screen.getByText('manual.pdf')).toBeInTheDocument();
        expect(onRemove).toHaveBeenCalledOnce();
    });
});
