import React from 'react';
import { Project } from '../../../types/projects';

interface ProjectDebugTabProps {
    project: Project;
    links: Array<{
        id: string;
        sourcetype: string;
        sourceid: string;
        targettype: string;
        targetid: string;
    }>;
}

export const ProjectDebugTab: React.FC<ProjectDebugTabProps> = ({ project, links }) => {
    const projectLinks = links.filter(l =>
        (String(l.sourceid) === String(project.id) && l.sourcetype === 'project') ||
        (String(l.targetid) === String(project.id) && l.targettype === 'project')
    );

    return (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-auto">
            <h3 className="font-bold text-slate-800 dark:text-white mb-4">Raw Links Debugger</h3>
            <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded border border-yellow-200 text-sm">
                Project ID: {project.id} <br />
                Total Links in Store: {links.length}
            </div>
            <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase">
                    <tr>
                        <th className="p-2">Link ID</th>
                        <th className="p-2">Source Type</th>
                        <th className="p-2">Source ID</th>
                        <th className="p-2">Target Type</th>
                        <th className="p-2">Target ID</th>
                        <th className="p-2">Match?</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {projectLinks.map(link => (
                        <tr key={link.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                            <td className="p-2 font-mono">{link.id}</td>
                            <td className="p-2 font-mono text-blue-600">{link.sourcetype}</td>
                            <td className="p-2 font-mono">{link.sourceid}</td>
                            <td className="p-2 font-mono text-green-600">{link.targettype}</td>
                            <td className="p-2 font-mono">{link.targetid}</td>
                            <td className="p-2">
                                {String(link.sourceid) === String(project.id) ? 'Source' : 'Target'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {projectLinks.length === 0 && (
                <p className="text-center py-4 text-slate-400">No links found for this project ID in local store.</p>
            )}
        </div>
    );
};

export default ProjectDebugTab;
