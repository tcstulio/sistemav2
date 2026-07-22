import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessages, CHAT_JOB_NOTIFICATIONS_KEY } from '../../components/chat/ChatMessages';
import { AiService } from '../../services/aiService';

vi.mock('../../services/aiService', () => ({
  AiService: {
    cancelChatJob: vi.fn(),
    notifyChatJobVisibility: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, EventListener>();
  close = vi.fn();

  constructor(public url: string, public options?: EventSourceInit) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string) {
    this.listeners.delete(type);
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
};

describe('ChatMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    localStorage.clear();
    setVisibility('visible');
  });

  it('mostra Cancelar somente com job ativo e envia o cancelamento', async () => {
    const cancel = vi.mocked(AiService.cancelChatJob).mockResolvedValue(true);
    const { rerender } = render(<ChatMessages activeJobId={null} onCancelled={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    rerender(<ChatMessages activeJobId="job-1" onCancelled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('job-1'));
  });

  it('entrega o resumo parcial ao receber cancelled', () => {
    const onCancelled = vi.fn();
    render(<ChatMessages activeJobId="job-2" onCancelled={onCancelled} />);

    act(() => MockEventSource.instances[0].emit('cancelled', { summary: 'Concluí a consulta parcial.' }));

    expect(onCancelled).toHaveBeenCalledWith('job-2', 'Concluí a consulta parcial.');
    expect(MockEventSource.instances[0].close).toHaveBeenCalled();
  });

  it('sinaliza hidden em menos de 500ms ao trocar a visibilidade', () => {
    const notify = vi.mocked(AiService.notifyChatJobVisibility);
    render(<ChatMessages activeJobId="job-3" onCancelled={vi.fn()} />);
    const startedAt = performance.now();

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(notify).toHaveBeenCalledWith('job-3', true);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('persiste a preferência de notificações no localStorage', () => {
    render(<ChatMessages activeJobId="job-4" onCancelled={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar notificações deste chat' }));
    expect(localStorage.getItem(CHAT_JOB_NOTIFICATIONS_KEY)).toBe('false');
  });
});
