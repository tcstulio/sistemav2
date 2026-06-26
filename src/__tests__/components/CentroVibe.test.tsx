import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ArtistList from '../../components/CentroVibe/ArtistList';
import NewEventModal from '../../components/CentroVibe/NewEventModal';
import EventDetailsModal from '../../components/CentroVibe/EventDetailsModal';
import CentroVibeManager from '../../components/CentroVibe/CentroVibeManager';
import { INITIAL_ARTISTS, INITIAL_SCHEDULE } from '../../components/CentroVibe/constants';
import { Artist, VenueEvent } from '../../types/centrovibe';
import { useDolibarr } from '../../context/DolibarrContext';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// #853 — ArtistList/EventDetailsModal/CentroVibeManager consomem canDo do useDolibarr.
// Default seguro (admin): canDo sempre true para preservar os testes existentes.
vi.mock('../../context/DolibarrContext', () => ({
  useDolibarr: vi.fn(() => ({ canDo: () => true })),
}));

// #856 — ArtistList/EventDetailsModal trocaram window.confirm por useConfirm (modal do DS).
// Mock determinístico: confirmState.result controla o retorno do confirm() assíncrono.
const { mockConfirm, confirmState } = vi.hoisted(() => {
  const confirmState = { result: true };
  return { mockConfirm: vi.fn(() => Promise.resolve(confirmState.result)), confirmState };
});
vi.mock('../../hooks/useConfirm', () => ({
  useConfirm: () => mockConfirm,
}));

// #853 — CentroVibeManager carrega dados via CentroVibeService no mount.
// Mock determinístico: fetchData falha -> cai no catch -> saveData resolve -> loading=false.
vi.mock('../../services/centrovibeService', () => ({
  CentroVibeService: {
    fetchData: vi.fn().mockRejectedValue(new Error('sem backend')),
    saveData: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockArtist: Artist = {
  id: 'test-1',
  name: 'DJ Teste',
  role: 'dj',
  cluster: 'brasil_raiz',
  subGenre: 'Pagode',
  instagram: '@djteste',
  rate: '$$',
};

describe('ArtistList', () => {
  const onAddArtist = vi.fn();
  const onUpdateArtist = vi.fn();
  const onDeleteArtist = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    confirmState.result = true;
  });

  it('renderiza botões de editar e excluir por card', () => {
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    expect(screen.getByTitle('Editar artista')).toBeTruthy();
    expect(screen.getByTitle('Excluir artista')).toBeTruthy();
  });

  it('clicar em excluir chama onDeleteArtist com o id correto', async () => {
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Excluir artista'));
    await waitFor(() => expect(onDeleteArtist).toHaveBeenCalledWith('test-1'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Excluir artista?', danger: true }));
  });

  it('clicar em editar abre modal com dados pré-preenchidos', () => {
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Editar artista'));
    expect(screen.getByDisplayValue('DJ Teste')).toBeTruthy();
  });

  it('salvar edição chama onUpdateArtist com dados atualizados', () => {
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Editar artista'));
    const nameInput = screen.getByDisplayValue('DJ Teste');
    fireEvent.change(nameInput, { target: { value: 'DJ Editado' } });
    fireEvent.click(screen.getByText('Salvar Alterações'));
    expect(onUpdateArtist).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-1', name: 'DJ Editado' })
    );
  });

  it('campo rate é editável no modal de cadastro', () => {
    render(
      <ArtistList
        artists={[]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByText('Novo Talento'));
    expect(screen.getByDisplayValue('$$ (R$500–2k)')).toBeTruthy();
  });

  it('não excluir se confirm retornar false', async () => {
    confirmState.result = false;
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Excluir artista'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(onDeleteArtist).not.toHaveBeenCalled();
  });

  it('renderiza múltiplos artistas com botões independentes', () => {
    const artists = INITIAL_ARTISTS.slice(0, 3);
    render(
      <ArtistList
        artists={artists}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    expect(screen.getAllByTitle('Editar artista')).toHaveLength(3);
    expect(screen.getAllByTitle('Excluir artista')).toHaveLength(3);
  });
});

describe('NewEventModal', () => {
  const onAddEvent = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('não renderiza quando isOpen=false', () => {
    render(
      <NewEventModal
        isOpen={false}
        schedule={INITIAL_SCHEDULE}
        onClose={onClose}
        onAddEvent={onAddEvent}
      />
    );
    expect(screen.queryByText('Novo Evento na Agenda')).toBeNull();
  });

  it('renderiza quando isOpen=true', () => {
    render(
      <NewEventModal
        isOpen={true}
        schedule={INITIAL_SCHEDULE}
        onClose={onClose}
        onAddEvent={onAddEvent}
      />
    );
    expect(screen.getByText('Novo Evento na Agenda')).toBeTruthy();
  });

  it('preencher e confirmar chama onAddEvent com o evento correto', () => {
    render(
      <NewEventModal
        isOpen={true}
        schedule={INITIAL_SCHEDULE}
        onClose={onClose}
        onAddEvent={onAddEvent}
      />
    );
    const titleInput = screen.getByPlaceholderText('Ex: Samba da Firma');
    fireEvent.change(titleInput, { target: { value: 'Show Teste' } });
    fireEvent.click(screen.getByText('Criar Evento'));
    expect(onAddEvent).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ title: 'Show Teste' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('não chama onAddEvent com título vazio', () => {
    render(
      <NewEventModal
        isOpen={true}
        schedule={INITIAL_SCHEDULE}
        onClose={onClose}
        onAddEvent={onAddEvent}
      />
    );
    fireEvent.click(screen.getByText('Criar Evento'));
    expect(onAddEvent).not.toHaveBeenCalled();
  });

  it('selecionar dia diferente passa o índice correto', () => {
    render(
      <NewEventModal
        isOpen={true}
        schedule={INITIAL_SCHEDULE}
        onClose={onClose}
        onAddEvent={onAddEvent}
      />
    );
    const select = screen.getByDisplayValue(/Segunda/);
    fireEvent.change(select, { target: { value: '2' } });
    const titleInput = screen.getByPlaceholderText('Ex: Samba da Firma');
    fireEvent.change(titleInput, { target: { value: 'Quarta Show' } });
    fireEvent.click(screen.getByText('Criar Evento'));
    expect(onAddEvent).toHaveBeenCalledWith(2, expect.objectContaining({ title: 'Quarta Show' }));
  });
});

// ---------------------------------------------------------------------------
// #853: Gating canDo('create'|'edit'|'delete','centrovibe') em ArtistList
// ---------------------------------------------------------------------------
describe('ArtistList (#853) — gating canDo', () => {
  const onAddArtist = vi.fn();
  const onUpdateArtist = vi.fn();
  const onDeleteArtist = vi.fn();

  const setCanDo = (fn: (action: string, screenName: string) => boolean) =>
    vi.mocked(useDolibarr).mockReturnValue({ canDo: fn } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    confirmState.result = true;
    setCanDo(() => true);
  });

  it('admin (canDo true) vê todos os botões de mutação', () => {
    render(
      <ArtistList artists={[mockArtist]} onAddArtist={onAddArtist} onUpdateArtist={onUpdateArtist} onDeleteArtist={onDeleteArtist} />
    );
    expect(screen.getByText('Novo Talento')).toBeTruthy();
    expect(screen.getByTitle('Editar artista')).toBeTruthy();
    expect(screen.getByTitle('Excluir artista')).toBeTruthy();
  });

  it('oculta "Novo Talento" quando canDo("create","centrovibe") é falso', () => {
    setCanDo((action, scrn) => !(action === 'create' && scrn === 'centrovibe'));
    render(
      <ArtistList artists={[mockArtist]} onAddArtist={onAddArtist} onUpdateArtist={onUpdateArtist} onDeleteArtist={onDeleteArtist} />
    );
    expect(screen.queryByText('Novo Talento')).toBeNull();
    expect(screen.getByTitle('Editar artista')).toBeTruthy();
    expect(screen.getByTitle('Excluir artista')).toBeTruthy();
  });

  it('oculta botão de editar quando canDo("edit","centrovibe") é falso', () => {
    setCanDo((action, scrn) => !(action === 'edit' && scrn === 'centrovibe'));
    render(
      <ArtistList artists={[mockArtist]} onAddArtist={onAddArtist} onUpdateArtist={onUpdateArtist} onDeleteArtist={onDeleteArtist} />
    );
    expect(screen.queryByTitle('Editar artista')).toBeNull();
    expect(screen.getByText('Novo Talento')).toBeTruthy();
    expect(screen.getByTitle('Excluir artista')).toBeTruthy();
  });

  it('oculta botão de excluir quando canDo("delete","centrovibe") é falso', () => {
    setCanDo((action, scrn) => !(action === 'delete' && scrn === 'centrovibe'));
    render(
      <ArtistList artists={[mockArtist]} onAddArtist={onAddArtist} onUpdateArtist={onUpdateArtist} onDeleteArtist={onDeleteArtist} />
    );
    expect(screen.queryAllByTitle('Excluir artista')).toHaveLength(0);
    expect(screen.getByTitle('Editar artista')).toBeTruthy();
  });

  it('sem permissão centrovibe: não renderiza nenhum botão de mutação', () => {
    setCanDo((_action, scrn) => scrn !== 'centrovibe');
    render(
      <ArtistList artists={[mockArtist]} onAddArtist={onAddArtist} onUpdateArtist={onUpdateArtist} onDeleteArtist={onDeleteArtist} />
    );
    expect(screen.queryByText('Novo Talento')).toBeNull();
    expect(screen.queryAllByTitle('Editar artista')).toHaveLength(0);
    expect(screen.queryAllByTitle('Excluir artista')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EventDetailsModal — render básico + gating canDo (#853)
// ---------------------------------------------------------------------------
const mockEvent: VenueEvent = {
  id: 'evt-1',
  title: 'Show Teste',
  description: 'Descrição do show',
  startTime: '20:00',
  endTime: '23:00',
  space: 'main_hall',
  cluster: 'brasil_raiz',
  genre: 'Samba',
  lineup: ['test-1'],
  tickets: [{ id: 't1', name: 'Lote 1', price: 50, totalCount: 100, status: 'active' }],
};

describe('EventDetailsModal', () => {
  const onClose = vi.fn();
  const onUpdateEvent = vi.fn();
  const onDeleteEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    confirmState.result = true;
    vi.mocked(useDolibarr).mockReturnValue({ canDo: () => true } as any);
  });

  it('renderiza o título do evento quando aberto', () => {
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.getByDisplayValue('Show Teste')).toBeTruthy();
  });

  it('com permissão: exibe botões de editar (Add Atração/Add Lote) e excluir', () => {
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.getByText('Add Atração')).toBeTruthy();
    expect(screen.getByText('Add Lote')).toBeTruthy();
    expect(screen.getByTitle('Excluir evento')).toBeTruthy();
    expect(screen.getByTitle('Excluir lote')).toBeTruthy();
    expect(screen.getByTitle('Remover do lineup')).toBeTruthy();
  });

  // #856 — excluir evento usa useConfirm (modal do design system), não window.confirm.
  it('confirmar exclusão de evento chama onDeleteEvent e onClose', async () => {
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    fireEvent.click(screen.getByTitle('Excluir evento'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Excluir este evento da agenda?', danger: true })));
    await waitFor(() => expect(onDeleteEvent).toHaveBeenCalledWith('evt-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('cancelar exclusão de evento não chama onDeleteEvent nem onClose', async () => {
    confirmState.result = false;
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    fireEvent.click(screen.getByTitle('Excluir evento'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(onDeleteEvent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EventDetailsModal (#853) — gating canDo', () => {
  const onClose = vi.fn();
  const onUpdateEvent = vi.fn();
  const onDeleteEvent = vi.fn();

  const setCanDo = (fn: (action: string, screenName: string) => boolean) =>
    vi.mocked(useDolibarr).mockReturnValue({ canDo: fn } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    confirmState.result = true;
    setCanDo(() => true);
  });

  it('sem canDo("edit","centrovibe"): oculta Add Atração e Add Lote', () => {
    setCanDo((action, scrn) => !(action === 'edit' && scrn === 'centrovibe'));
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.queryByText('Add Atração')).toBeNull();
    expect(screen.queryByText('Add Lote')).toBeNull();
    expect(screen.getByTitle('Excluir evento')).toBeTruthy();
  });

  it('sem canDo("delete","centrovibe"): oculta exclusão de evento, lote e lineup', () => {
    setCanDo((action, scrn) => !(action === 'delete' && scrn === 'centrovibe'));
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.queryByTitle('Excluir evento')).toBeNull();
    expect(screen.queryAllByTitle('Excluir lote')).toHaveLength(0);
    expect(screen.queryAllByTitle('Remover do lineup')).toHaveLength(0);
    expect(screen.getByText('Add Atração')).toBeTruthy();
  });

  it('sem permissão centrovibe: não renderiza nenhum botão de mutação', () => {
    setCanDo((_action, scrn) => scrn !== 'centrovibe');
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.queryByText('Add Atração')).toBeNull();
    expect(screen.queryByText('Add Lote')).toBeNull();
    expect(screen.queryByTitle('Excluir evento')).toBeNull();
    expect(screen.queryAllByTitle('Excluir lote')).toHaveLength(0);
    expect(screen.queryAllByTitle('Remover do lineup')).toHaveLength(0);
  });

  it('componente de visualização (detalhes) continua renderizando para todos', () => {
    setCanDo(() => false);
    render(
      <EventDetailsModal event={mockEvent} onClose={onClose} onUpdateEvent={onUpdateEvent} onDeleteEvent={onDeleteEvent} allArtists={[mockArtist]} />
    );
    expect(screen.getByDisplayValue('Show Teste')).toBeTruthy();
    expect(screen.getByDisplayValue('Lote 1')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CentroVibeManager — gating canDo no botão "Novo Evento" (#853)
// ---------------------------------------------------------------------------
describe('CentroVibeManager (#853) — gating canDo no botão "Novo Evento"', () => {
  const setCanDo = (fn: (action: string, screenName: string) => boolean) =>
    vi.mocked(useDolibarr).mockReturnValue({ canDo: fn } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    confirmState.result = true;
    setCanDo(() => true);
  });

  it('admin (canDo("create","centrovibe")) vê o botão "Novo Evento"', async () => {
    setCanDo(() => true);
    render(<CentroVibeManager />);
    await waitFor(() => expect(screen.getByText('Agenda Modelo (Semanal)')).toBeTruthy());
    expect(screen.getByText('Novo Evento')).toBeTruthy();
  });

  it('sem canDo("create","centrovibe"): não exibe o botão "Novo Evento"', async () => {
    setCanDo((action, scrn) => !(action === 'create' && scrn === 'centrovibe'));
    render(<CentroVibeManager />);
    await waitFor(() => expect(screen.getByText('Agenda Modelo (Semanal)')).toBeTruthy());
    expect(screen.queryByText('Novo Evento')).toBeNull();
  });

  it('sem nenhuma permissão centrovibe: agenda (visualização) continua renderizando', async () => {
    setCanDo((_action, scrn) => scrn !== 'centrovibe');
    render(<CentroVibeManager />);
    await waitFor(() => expect(screen.getByText('Agenda Modelo (Semanal)')).toBeTruthy());
    expect(screen.queryByText('Novo Evento')).toBeNull();
  });
});
