import React from 'react';
import DOMPurify from 'dompurify';

// Sanitização de HTML não-confiável (descrições do Dolibarr, corpo de e-mail, etc.)
// usando DOMPurify (battle-tested) em vez de uma implementação caseira (#33).

// Hook: garante que todo link abra em nova aba sem expor window.opener.
let hookAdded = false;
function ensureHook(): void {
    if (hookAdded) return;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node instanceof Element && node.tagName === 'A' && node.getAttribute('href')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });
    hookAdded = true;
}

/** Remove scripts, handlers on*, javascript:/data: URLs, iframes etc. — mantém HTML de formatação. */
export function sanitizeHtml(html: string): string {
    if (!html) return '';
    ensureHook();
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/** Remove TODAS as tags, devolvendo só o texto. */
export function stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
}

export const SafeHtml: React.FC<{ html: string; className?: string; as?: keyof React.JSX.IntrinsicElements }> = ({ html, className, as: Tag = 'div' }) => {
    const sanitized = sanitizeHtml(html);
    return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
};
