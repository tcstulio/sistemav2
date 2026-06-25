import React, { useEffect, useState } from 'react';
import { DolibarrUser, DolibarrConfig } from '../../types';

interface UserAvatarProps {
    user: DolibarrUser;
    config?: DolibarrConfig;
    size?: 'sm' | 'md' | 'lg';
}

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-24 h-24 text-2xl',
};

const buildInitials = (user: DolibarrUser): string =>
    ((user.firstname?.[0] || '') + (user.lastname?.[0] || user.login?.[0] || '?')).toUpperCase();

const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

export const UserAvatar: React.FC<UserAvatarProps> = ({ user, size = 'md' }) => {
    const initials = buildInitials(user);
    // Chave que identifica unicamente a foto (id+nome do arquivo). null quando não há foto.
    const fetchKey = user.id && user.photo ? `${user.id}|${user.photo}` : null;

    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [prevKey, setPrevKey] = useState<string | null>(null);

    // "Ajustar estado durante o render" (padrão oficial do React): quando a foto muda/some,
    // reseta o estado sincronamente no render em vez de dentro de um effect (evita
    // setState síncrono em effect / cascata de renders).
    if (prevKey !== fetchKey) {
        setPrevKey(fetchKey);
        setPhotoUrl(null);
    }

    // Carrega o avatar via fetch (e NÃO via <img src>): um 404 de <img> sempre polui o console
    // ("Failed to load resource"), mesmo com onError. Com fetch, uma resposta não-OK simplesmente
    // cai no fallback de iniciais — sem ruído de console. Cada avatar usa o próprio id+photo do
    // usuário, então não há troca de foto entre usuários. (#824)
    useEffect(() => {
        if (!user.photo || !user.id) return;

        let cancelled = false;
        const targetUrl = `/api/documents/user-photo?userId=${user.id}&file=${encodeURIComponent(user.photo)}`;

        fetch(targetUrl, { credentials: 'same-origin' })
            .then((res) => (res.ok ? res.blob() : null))
            .then((blob) => {
                if (cancelled) return;
                if (blob && blob.size > 0 && canCreateObjectUrl) {
                    setPhotoUrl(URL.createObjectURL(blob));
                }
            })
            .catch(() => {
                /* sem foto → mantém o fallback de iniciais */
            });

        return () => {
            cancelled = true;
        };
    }, [user.id, user.photo]);

    // Revoga o object URL anterior (troca de foto/desmonte) para evitar leak de memória.
    useEffect(() => {
        return () => {
            if (photoUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(photoUrl);
            }
        };
    }, [photoUrl]);

    if (photoUrl) {
        return (
            <img
                src={photoUrl}
                alt={user.login || initials}
                className={`${sizeClasses[size]} rounded-full object-cover border-2 border-white dark:border-slate-800 shadow-md bg-white`}
                onError={() => setPhotoUrl(null)}
            />
        );
    }

    return (
        <div
            className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-bold text-white shadow-md bg-indigo-600 border-2 border-white dark:border-slate-800`}
            role="img"
            aria-label={user.login || initials}
        >
            {initials}
        </div>
    );
};
