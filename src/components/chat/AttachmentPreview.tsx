import React, { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';

interface AttachmentPreviewProps {
    file: File;
    onRemove: () => void;
    disabled?: boolean;
}

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ file, onRemove, disabled = false }) => {
    const isImage = file.type.startsWith('image/');
    const extension = file.name.split('.').pop()?.toLowerCase();
    const isVideo = file.type === 'video/mp4'
        || file.type === 'video/webm'
        || (!file.type && (extension === 'mp4' || extension === 'webm'));
    const [objectUrl] = useState(() => isImage || isVideo
        ? (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '')
        : '');
    const [thumbnailUrl, setThumbnailUrl] = useState('');

    useEffect(() => {
        return () => {
            if (objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl]);

    useEffect(() => {
        if (!isVideo || !objectUrl) return;

        const video = document.createElement('video');
        const canvas = document.createElement('canvas');

        const captureThumbnail = () => {
            if (!video.videoWidth || !video.videoHeight) return;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.8));
        };

        const seekToFrame = () => {
            if (Number.isFinite(video.duration) && video.duration > 0.1) {
                video.currentTime = Math.min(0.5, video.duration / 2);
            } else {
                captureThumbnail();
            }
        };

        video.muted = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.src = objectUrl;
        video.addEventListener('loadeddata', seekToFrame);
        video.addEventListener('seeked', captureThumbnail);

        return () => {
            video.removeEventListener('loadeddata', seekToFrame);
            video.removeEventListener('seeked', captureThumbnail);
            video.removeAttribute('src');
        };
    }, [isVideo, objectUrl]);

    return (
        <div className="relative flex gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-700/50" aria-label={`Anexo ${file.name}`}>
            <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
                {isImage && objectUrl ? (
                    <img src={objectUrl} alt={`Pré-visualização de ${file.name}`} className="h-full w-full object-cover" />
                ) : isVideo && objectUrl ? (
                    <video
                        src={objectUrl}
                        poster={thumbnailUrl || undefined}
                        controls
                        preload="metadata"
                        aria-label={`Pré-visualização do vídeo ${file.name}`}
                        className="h-full w-full bg-black object-cover"
                    />
                ) : (
                    <FileText size={28} className="text-gray-500" aria-hidden="true" />
                )}
            </div>
            <div className="min-w-0 flex-1 self-center pr-7">
                <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-200" title={file.name}>{file.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
            </div>
            <button
                type="button"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`Remover ${file.name}`}
                className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-500 disabled:opacity-50 dark:hover:bg-gray-600"
            >
                <X size={16} />
            </button>
        </div>
    );
};
