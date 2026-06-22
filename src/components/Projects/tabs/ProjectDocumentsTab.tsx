import React from 'react';
import { Files, File, Trash2, Upload, ExternalLink, Loader2 } from 'lucide-react';
import { Project } from '../../../types/projects';
import { DolibarrDocument, DolibarrConfig } from '../../../types/common';
import { DolibarrService } from '../../../services/dolibarrService';

interface ProjectDocumentsTabProps {
    project: Project;
    config: DolibarrConfig;
    documents: DolibarrDocument[];
    isLoading: boolean;
    isUploading: boolean;
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onDelete: (filename: string) => void;
}

export const ProjectDocumentsTab: React.FC<ProjectDocumentsTabProps> = ({
    project,
    config,
    documents,
    isLoading,
    isUploading,
    onUpload,
    onDelete
}) => {
    const handleDownload = (filename: string) => {
        // File-specific download via direct Dolibarr URL (file path, not entityId)
        const url = `${config.apiUrl}/documents/download?module_part=project&original_file=${encodeURIComponent(`${project.ref}/${filename}`)}`;
        window.open(url, '_blank', 'noreferrer');
    };

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-slate-800 dark:text-white">Arquivos do Projeto</h3>
                <div className="relative">
                    <input
                        type="file"
                        id="file-upload"
                        className="hidden"
                        onChange={onUpload}
                        disabled={isUploading}
                    />
                    <label
                        htmlFor="file-upload"
                        className={`flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-indigo-700 transition-colors ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload
                    </label>
                </div>
            </div>

            {documents.length === 0 ? (
                <div className="text-center py-10 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <Files size={32} className="mx-auto mb-2 opacity-50" />
                    <p>Nenhum documento encontrado.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {documents.map((doc, idx) => (
                        <div
                            key={idx}
                            className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between group hover:border-indigo-300 transition-colors"
                        >
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded text-slate-500">
                                    <File size={20} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate" title={doc.name}>
                                        {doc.name}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        {(doc.size ? doc.size / 1024 : 0).toFixed(1)} KB
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => handleDownload(doc.name)}
                                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                >
                                    <ExternalLink size={14} />
                                </button>
                                <button
                                    onClick={() => onDelete(doc.name)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProjectDocumentsTab;
