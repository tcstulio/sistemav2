import React from 'react';

const DANGEROUS_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'form', 'input', 'textarea', 'select', 'button', 'meta', 'link', 'base', 'style', 'svg', 'math', 'noscript', 'template']);

function cleanNode(node: Element) {
    for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i] as Element;
        const tagName = child.tagName.toLowerCase();

        if (DANGEROUS_TAGS.has(tagName)) {
            child.remove();
            continue;
        }

        for (let j = child.attributes.length - 1; j >= 0; j--) {
            const attr = child.attributes[j];
            const name = attr.name.toLowerCase();
            if (
                name.startsWith('on') ||
                (name === 'href' && /^\s*(javascript|data|vbscript)\s*:/i.test(attr.value)) ||
                (name === 'src' && /^\s*(javascript|data|vbscript)\s*:/i.test(attr.value)) ||
                name === 'formaction' ||
                name === 'xlink:href'
            ) {
                child.removeAttributeNode(attr);
            }
        }

        cleanNode(child);
    }
}

export function sanitizeHtml(html: string): string {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    cleanNode(doc.body);
    return doc.body.innerHTML;
}

export function stripHtml(html: string): string {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '');
}

export const SafeHtml: React.FC<{ html: string; className?: string; as?: keyof React.JSX.IntrinsicElements }> = ({ html, className, as: Tag = 'div' }) => {
    const sanitized = sanitizeHtml(html);
    return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />;
};
