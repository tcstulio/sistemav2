import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { LegacySingularNewRedirect } from '../../components/LegacySingularNewRedirect';

// Sonda no destino: mostra o pathname + search para conferir o redirect e a preservação da query.
function Probe() {
    const loc = useLocation();
    return <div data-testid="probe">{loc.pathname}{loc.search}</div>;
}

function renderAt(initial: string) {
    return render(
        <MemoryRouter initialEntries={[initial]}>
            <Routes>
                {/* Rotas plurais estáticas (destino do redirect) — rankeiam acima da dinâmica */}
                <Route path="/tasks/new" element={<Probe />} />
                <Route path="/proposals/new" element={<Probe />} />
                {/* A rota legacy dinâmica */}
                <Route path="/:entity/new" element={<LegacySingularNewRedirect />} />
                <Route path="*" element={<div data-testid="probe">NOTFOUND</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('LegacySingularNewRedirect (#1521)', () => {
    it('/task/new?prefill=abc → redireciona p/ /tasks/new PRESERVANDO ?prefill=abc', () => {
        renderAt('/task/new?prefill=abc');
        expect(screen.getByTestId('probe').textContent).toBe('/tasks/new?prefill=abc');
    });

    it('/proposal/new → /proposals/new', () => {
        renderAt('/proposal/new');
        expect(screen.getByTestId('probe').textContent).toBe('/proposals/new');
    });

    it('rota estática plural NÃO é interceptada pela dinâmica (/tasks/new renderiza direto)', () => {
        renderAt('/tasks/new?prefill=xyz');
        expect(screen.getByTestId('probe').textContent).toBe('/tasks/new?prefill=xyz');
    });

    it('singular DESCONHECIDO (/foo/new) → NotFound (não redireciona)', () => {
        renderAt('/foo/new');
        // NotFound renderiza o "404" grande; basta não ter virado uma rota plural
        expect(screen.queryByTestId('probe')).toBeNull();
        expect(screen.getByText(/página não encontrada/i)).toBeTruthy();
    });
});
