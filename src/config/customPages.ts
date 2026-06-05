// #113 — Telas customizadas por grupo. Tipos + registries compartilhados entre o
// runtime (CustomPageView) e o editor (CustomPagesEditor). Espelha o modelo do backend
// (uiConfigService); o saneamento autoritativo fica no servidor.

export type CustomBlockType = 'richtext' | 'links' | 'widget' | 'embed';

export interface CustomPageLink {
    label: string;
    url: string;
    external?: boolean;
}

export interface CustomBlock {
    id: string;
    type: CustomBlockType;
    title?: string;
    html?: string;                  // richtext (saneado com sanitizeHtml ao renderizar)
    links?: CustomPageLink[];       // links
    widgetId?: string;              // widget (id de EMBEDDABLE_WIDGETS)
    embedUrl?: string;              // embed (iframe https)
    height?: number;                // embed — altura em px
}

export interface CustomPageVisibility {
    groups: string[];   // ids de grupo; vazio = todos os logados
    users: string[];    // ids de usuário
}

export interface CustomPage {
    id: string;
    title: string;
    icon?: string;      // nome de ícone lucide
    slug: string;       // rota /p/:slug
    visibility: CustomPageVisibility;
    blocks: CustomBlock[];
}

// Paleta do editor (rótulo + descrição curta por tipo de bloco).
export const BLOCK_TYPES: { type: CustomBlockType; label: string; hint: string }[] = [
    { type: 'richtext', label: 'Texto rico', hint: 'Conteúdo formatado (títulos, listas, links)' },
    { type: 'links', label: 'Atalhos', hint: 'Lista de links internos ou externos' },
    { type: 'widget', label: 'Widget do painel', hint: 'Incorpora um widget reutilizável' },
    { type: 'embed', label: 'Embed (iframe)', hint: 'Incorpora um dashboard/URL externo (https)' },
];

// Widgets reutilizáveis que podem ser incorporados numa página (id + rótulo).
// O runtime (CustomPageView) mapeia o id para o componente. Começa enxuto e cresce
// conforme widgets do Dashboard forem extraídos para componentes self-contained.
export const EMBEDDABLE_WIDGETS: { id: string; label: string }[] = [
    { id: 'financial-health', label: 'Análise Financeira (IA)' },
];

/** Visibilidade de página: admin sempre vê; allow-list vazia = todos os logados. */
export function canSeeCustomPage(
    page: Pick<CustomPage, 'visibility'>,
    opts: { isAdmin: boolean; userId?: string | null; groupIds?: string[] },
): boolean {
    if (opts.isAdmin) return true;
    const { groups = [], users = [] } = page.visibility || { groups: [], users: [] };
    if (groups.length === 0 && users.length === 0) return true; // sem restrição
    if (opts.userId && users.includes(String(opts.userId))) return true;
    const gids = opts.groupIds || [];
    return groups.some((g) => gids.includes(String(g)));
}
