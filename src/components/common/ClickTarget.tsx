import React from 'react';

/**
 * ClickTarget — primitives para cards de lista onde a superfície inteira dispara
 * uma ação "primária" (ex.: abrir o detalhe), mas que precisam conter outros
 * elementos interativos (ex.: ir ao cliente, excluir) como alvos de clique
 * **distintos e independentes**, sem aninhar `<button>` dentro de `<button>`
 * (o que seria HTML inválido e quebraria teclado/leitores de tela).
 *
 * Padrão utilizado: "stretched link" (link esticado). A ação primária é um
 * `<button>` real cujo pseudo-elemento `::after` (position:absolute; inset:0)
 * estica a área de clique para cobrir todo o container posicionado mais próximo
 * (o `<ClickTarget>`). Elementos interativos secundários ficam marcados com
 * `position: relative; z-index` (via `<ClickTargetSecondary>`), ficando acima
 * do `::after` e permanecendo clicáveis de forma independente.
 *
 * Como o botão primário e os secundários são **irmãos** (não aninhados), o HTML
 * resultante é válido e cada alvo de clique funciona de forma isolada.
 *
 * @example
 * ```tsx
 * <ClickTarget selected={selected} hoverable>
 *   <div className="flex justify-between">
 *     <ClickTargetPrimary onClick={openInvoice} aria-label={`Abrir fatura ${ref}`}>
 *       {ref}
 *     </ClickTargetPrimary>
 *     <ClickTargetSecondary className="flex gap-1">
 *       <button onClick={goToCustomer}>Cliente</button>
 *     </ClickTargetSecondary>
 *   </div>
 * </ClickTarget>
 * ```
 */

export interface ClickTargetProps {
    /** Conteúdo do card (inclui ClickTargetPrimary e os ClickTargetSecondary). */
    children: React.ReactNode;
    /** Classes extras do container (ex.: dimensões de grid). */
    className?: string;
    /** Estado selecionado (destaque de borda/fundo). */
    selected?: boolean;
    /** Habilita sombra ao passar o mouse (affordance). */
    hoverable?: boolean;
}

/**
 * Container do card. DEVE ser o ancestral posicionado (relative) para que o
 * `::after` do `<ClickTargetPrimary>` estique sobre toda a sua área.
 * Renderiza um `<div>` (nunca um `<button>`), evitando o aninhamento inválido.
 */
export const ClickTarget: React.FC<ClickTargetProps> = ({
    children,
    className = '',
    selected = false,
    hoverable = false,
}) => {
    return (
        <div
            className={[
                'group relative bg-white dark:bg-slate-900 border rounded-xl',
                selected
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-slate-200 dark:border-slate-800',
                hoverable ? 'hover:shadow-md transition-all' : 'shadow-sm',
                'focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset',
                className,
            ]
                .join(' ')
                .trim()}
        >
            <div className="p-4">{children}</div>
        </div>
    );
};

export interface ClickTargetPrimaryProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * Rótulo acessível (obrigatório) que descreve a ação primária esticada
     * (ex.: "Abrir fatura FA2501-0001"), já que a área clicável é maior que o
     * conteúdo visível do botão.
     */
    'aria-label': string;
}

/**
 * Botão da ação primária. Seu `::after` (inset-0) estica a área de clique sobre
 * todo o `<ClickTarget>`. O botão em si permanece `position: static` para que o
 * `::after` seja posicionado em relação ao container (e não ao próprio botão).
 */
export const ClickTargetPrimary: React.FC<ClickTargetPrimaryProps> = ({
    className = '',
    type = 'button',
    children,
    ...rest
}) => {
    return (
        <button
            type={type}
            className={[
                'cursor-pointer text-left bg-transparent border-0 p-0',
                // área de clique esticada sobre o container posicionado mais próximo
                'after:content-[""] after:absolute after:inset-0 after:rounded-xl',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                className,
            ]
                .join(' ')
                .trim()}
            {...rest}
        >
            {children}
        </button>
    );
};

export interface ClickTargetSecondaryProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Permite forçar o elemento rendered (default: span). */
    as?: 'span' | 'div';
}

/**
 * Wrapper para elementos interativos secundários (links/botões) dentro de um
 * `<ClickTarget>`. Posiciona-os acima (`relative z-10`) do `::after` do botão
 * primário, mantendo-os clicáveis de forma independente e preservando HTML
 * válido (o secundário é irmão do primário, não seu descendente).
 */
export const ClickTargetSecondary: React.FC<ClickTargetSecondaryProps> = ({
    className = '',
    as = 'span',
    children,
    ...rest
}) => {
    const Component = as;
    return (
        <Component
            className={['relative z-10', className].join(' ').trim()}
            {...rest}
        >
            {children}
        </Component>
    );
};
