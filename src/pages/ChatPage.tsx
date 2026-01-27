
import React from 'react';
import { useParams } from 'react-router-dom';
import { ChatInterface } from '../components/Chat/ChatInterface';
import { ChatLayout } from '../components/Chat/ChatLayout';
import { MessageSquare } from 'lucide-react';
import { useUsers, useProjects } from '../hooks/dolibarr';
import { useDolibarr } from '../context/DolibarrContext';

export const ChatPage: React.FC = () => {
    return (
        <ChatLayout />
    );
};

export const ChatConversation: React.FC = () => {
    const { type, id } = useParams<{ type: string; id: string }>();
    const { config } = useDolibarr();

    // Resolve name for header
    const { data: users } = useUsers(config);
    const { data: projects } = useProjects(config);

    let title = "Chat";
    if (type === 'user' && users) {
        const u = users.find((x: any) => String(x.id) === String(id));
        if (u) title = u.firstname ? `${u.firstname} ${u.lastname || ''}` : u.login;
    } else if (type === 'project' && projects) {
        const p = projects.find((x: any) => String(x.id) === String(id));
        if (p) title = `${p.ref} - ${p.title}`;
    }

    if (!type || !id) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400">
                <div className="bg-slate-100 dark:bg-slate-900 p-6 rounded-full mb-4">
                    <MessageSquare size={48} className="text-slate-300 dark:text-slate-700" />
                </div>
                <h2 className="text-xl font-semibold mb-2 text-slate-600 dark:text-slate-300">Suas Mensagens</h2>
                <p>Selecione uma conversa ao lado para começar.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <ChatInterface
                elementId={id}
                elementType={type}
                title={title}
                height="100%"
                onBack={() => window.history.back()}
            />
        </div>
    );
};
