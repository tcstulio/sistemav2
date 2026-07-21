import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Loader2, Square } from 'lucide-react';
import { toast } from 'sonner';
import { AiService } from '../../services/aiService';
import { safeStorage } from '../../utils/safeStorage';
import { usePageVisibility } from '../../hooks/usePageVisibility';

export const CHAT_JOB_NOTIFICATIONS_KEY = 'coolgroove_chat_job_notifications';

interface ChatMessagesProps {
  activeJobId: string | null;
  onCancelled: (jobId: string, summary: string) => void;
}

export function ChatMessages({ activeJobId, onCancelled }: ChatMessagesProps) {
  const isVisible = usePageVisibility();
  const previousVisibility = useRef(isVisible);
  const [isCancelling, setIsCancelling] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
    safeStorage.getItem(CHAT_JOB_NOTIFICATIONS_KEY) !== 'false'
  );

  useEffect(() => {
    if (!activeJobId || previousVisibility.current === isVisible) {
      previousVisibility.current = isVisible;
      return;
    }
    previousVisibility.current = isVisible;
    void AiService.notifyChatJobVisibility(activeJobId, !isVisible);
  }, [activeJobId, isVisible]);

  useEffect(() => {
    if (!activeJobId || typeof EventSource === 'undefined') return;

    const source = new EventSource(`/api/chat/jobs/${encodeURIComponent(activeJobId)}/events`, { withCredentials: true });
    const handleCancelled = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data.split(String.fromCharCode(0)).join('\n')) as { summary?: string };
      const summary = payload.summary || 'Cancelado por você.';
      onCancelled(activeJobId, summary);
      if (notificationsEnabled) toast.info(summary);
      source.close();
    };
    source.addEventListener('cancelled', handleCancelled);
    return () => {
      source.removeEventListener('cancelled', handleCancelled);
      source.close();
    };
  }, [activeJobId, notificationsEnabled, onCancelled]);

  const toggleNotifications = () => {
    setNotificationsEnabled(current => {
      const next = !current;
      safeStorage.setItem(CHAT_JOB_NOTIFICATIONS_KEY, String(next));
      return next;
    });
  };

  const cancel = async () => {
    if (!activeJobId || isCancelling) return;
    setIsCancelling(true);
    const accepted = await AiService.cancelChatJob(activeJobId);
    if (!accepted) {
      setIsCancelling(false);
      toast.error('Não foi possível cancelar o processamento.');
    }
  };

  if (!activeJobId) return null;

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={cancel}
        disabled={isCancelling}
        className="flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
      >
        {isCancelling ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />}
        {isCancelling ? 'Cancelando…' : 'Cancelar'}
      </button>
      <button
        type="button"
        onClick={toggleNotifications}
        className="p-1 text-slate-400 hover:text-indigo-600"
        title={notificationsEnabled ? 'Desativar notificações deste chat' : 'Ativar notificações deste chat'}
        aria-label={notificationsEnabled ? 'Desativar notificações deste chat' : 'Ativar notificações deste chat'}
      >
        {notificationsEnabled ? <Bell size={13} /> : <BellOff size={13} />}
      </button>
    </div>
  );
}
