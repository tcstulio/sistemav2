import React from 'react';
import { DolibarrUser, DolibarrConfig } from '../../types';

interface UserAvatarProps {
    user: DolibarrUser;
    config: DolibarrConfig;
    size?: 'sm' | 'md' | 'lg';
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ user, config, size = 'md' }) => {
    const sizeClasses = {
        sm: 'w-8 h-8 text-xs',
        md: 'w-10 h-10 text-sm',
        lg: 'w-24 h-24 text-2xl'
    };

    if (user.photo && user.id) {
        // Via proxy do backend (cookie httpOnly) — o token NÃO vai na URL da imagem (#33).
        const photoUrl = `/api/documents/user-photo?userId=${user.id}&file=${encodeURIComponent(user.photo)}`;

        return (
            <>
                <img
                    src={photoUrl}
                    alt={user.login}
                    className={`${sizeClasses[size]} rounded-full object-cover border-2 border-white dark:border-slate-800 shadow-md bg-white`}
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const sibling = e.currentTarget.parentElement?.querySelector('.fallback-initials');
                        if (sibling) sibling.classList.remove('hidden');
                    }}
                />
                <div className={`fallback-initials hidden ${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white shadow-md bg-indigo-600 border-2 border-white dark:border-slate-800`}>
                    {((user.firstname?.[0] || '') + (user.lastname?.[0] || user.login?.[0] || '?')).toUpperCase()}
                </div>
            </>
        );
    }

    const initials = ((user.firstname?.[0] || '') + (user.lastname?.[0] || user.login?.[0] || '?')).toUpperCase();

    return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white shadow-md bg-indigo-600 border-2 border-white dark:border-slate-800`}>
            {initials}
        </div>
    );
};
