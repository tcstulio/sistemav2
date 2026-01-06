
import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ChatSidebar } from './ChatSidebar';

export const ChatLayout: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-white dark:bg-slate-950">
            <ChatSidebar onSelect={(type, id) => {
                navigate(`/chat/${type}/${id}`);
            }} />
            <div className="flex-1 flex flex-col min-w-0">
                <Outlet />
            </div>
        </div>
    );
};
