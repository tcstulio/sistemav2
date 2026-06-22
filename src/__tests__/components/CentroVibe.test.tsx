import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ArtistList from '../../components/CentroVibe/ArtistList';
import NewEventModal from '../../components/CentroVibe/NewEventModal';
import { INITIAL_ARTISTS, INITIAL_SCHEDULE } from '../../components/CentroVibe/constants';
import { Artist } from '../../types/centrovibe';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

  it('clicar em excluir chama onDeleteArtist com o id correto', () => {
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Excluir artista'));
    expect(onDeleteArtist).toHaveBeenCalledWith('test-1');
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

  it('não excluir se confirm retornar false', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <ArtistList
        artists={[mockArtist]}
        onAddArtist={onAddArtist}
        onUpdateArtist={onUpdateArtist}
        onDeleteArtist={onDeleteArtist}
      />
    );
    fireEvent.click(screen.getByTitle('Excluir artista'));
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
