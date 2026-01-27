import React from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { ChatSidebar } from './ChatSidebar';
import { MasterDetailLayout } from '../ui/MasterDetailLayout';

export const ChatLayout: React.FC = () => {
    const navigate = useNavigate();
    const { type, id } = useParams<{ type: string; id: string }>();
    const hasActiveChat = !!(type && id);

    return (
        <div className="h-[calc(100vh-64px)] overflow-hidden bg-white dark:bg-slate-950 flex flex-col">
            <MasterDetailLayout
                list={
                    <ChatSidebar onSelect={() => { }} />
                }
                detail={<Outlet />}
                showDetail={hasActiveChat}
                onCloseDetail={() => navigate('/chat')}
                listWidth="1/4"
            />
        </div>
    );
};
