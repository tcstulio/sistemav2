/**
 * Task Notification Service (camada 2) — dispara as notificações de eventos de tarefa para os
 * envolvidos, conforme a matriz [evento × papel × canal] do UiConfigService.
 * A lógica pura (papéis/canais) fica em taskNotificationLogic (testável sem I/O).
 *
 * #1291 — Gate de quiet-hours por canal externo (WhatsApp/email) antes do dispatch.
 * in-app sempre passa; canal externo em silêncio (regra `notificationPolicy.quietHours`) é
 * adiado e loggado estruturadamente com `scheduledFor = próximo fim da janela`.
 */
import { dolibarrService } from './dolibarrService';
import { notificationService, NotificationChannel, NotificationEvent } from './notificationService';
import { uiConfigService } from './uiConfigService';
import type { TaskNotifEvent, NotifChannel } from './uiConfigService';
import { renderTaskTemplate } from './notificationTemplates';
import { resolveRoleUsers, planTargets, TaskContact } from './taskNotificationLogic';
import { isWithinQuietWindow, nextQuietEnd, getQuietHours } from './notifications/quietHours';
import { createLogger } from '../utils/logger';
import { resolveUserMobile } from '../utils/userMobile';

const log = createLogger('TaskNotifications');

export { resolveRoleUsers, planTargets, TASK_CONTACT_TYPE_IDS } from './taskNotificationLogic';

/** Aplica o gate de quiet-hours em uma lista de canais (in-app sempre passa). */
function applyQuietHoursGate(channels: NotifChannel[], now: Date): {
    dispatch: NotifChannel[];
    deferred: Array<{ canal: NotifChannel; scheduledFor: Date }>;
} {
    const quietHours = uiConfigService.get().notificationPolicy.quietHours;
    const dispatch: NotifChannel[] = [];
    const deferred: Array<{ canal: NotifChannel; scheduledFor: Date }> = [];
    for (const ch of channels) {
        if (ch === 'in-app') {
            dispatch.push(ch); // in-app nunca bloqueia (reversível/benigno)
            continue;
        }
        const rule = getQuietHours(quietHours, ch);
        if (rule && isWithinQuietWindow(now, rule)) {
            deferred.push({ canal: ch, scheduledFor: nextQuietEnd(now, rule) });
        } else {
            dispatch.push(ch);
        }
    }
    return { dispatch, deferred };
}

/** Dispara as notificações de um evento de tarefa para os envolvidos, conforme a matriz da config. */
export async function dispatchTaskNotification(
    event: TaskNotifEvent,
    task: any,
    opts?: { taskContacts?: TaskContact[] },
): Promise<void> {
    try {
        const cfg = uiConfigService.get();
        const contacts = opts?.taskContacts ?? await dolibarrService.getTaskContacts(String(task.id));
        const roleUsers = resolveRoleUsers(task, contacts);
        const externalOn = cfg.taskNotificationsExternalEnabled;
        const now = new Date();
        const targets = planTargets(event, roleUsers, cfg.taskNotifications)
            // trava de segurança: sem canais externos habilitados, só in-app sai (testável no webapp).
            .map((t) => {
                const filtered = externalOn ? t.channels : t.channels.filter((c) => c === 'in-app');
                // gate #1291: quiet-hours por canal externo — adia e loga em vez de disparar.
                const { dispatch, deferred } = applyQuietHoursGate(filtered, now);
                for (const d of deferred) {
                    log.info('notification.quietHours.deferred', {
                        canal: d.canal,
                        scheduledFor: d.scheduledFor.toISOString(),
                        originalDueAt: now.toISOString(),
                        event: `task.${event}`,
                        taskId: task?.id != null ? String(task.id) : undefined,
                        userId: t.userId,
                    });
                }
                return { userId: t.userId, channels: dispatch };
            })
            .filter((t) => t.channels.length > 0);
        if (!targets.length) return;

        for (const { userId, channels } of targets) {
            const user = await dolibarrService.getUserById(userId);
            const name = user
                ? `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.login || `Usuário ${userId}`
                : `Usuário ${userId}`;
            const vars = {
                nome: name,
                ref: task.ref || '',
                label: task.label || '',
                date: task.date_end ? new Date(Number(task.date_end) * 1000).toLocaleDateString('pt-BR') : '',
                progress: String(task.progress ?? ''),
            };
            const { title, message } = renderTaskTemplate(event, vars);
            await notificationService.create({
                event: `task.${event}` as NotificationEvent,
                title,
                message,
                channels: channels as NotificationChannel[],
                recipient: userId,
                recipientName: name,
                recipientPhone: resolveUserMobile(user) || user?.office_phone || undefined,
                recipientEmail: user?.email || undefined,
                priority: (event === 'overdue' || event === 'stalled') ? 'high' : 'medium',
                entityType: 'task',
                entityId: String(task.id),
            });
        }
        log.info(`dispatch task.${event} task=${task?.id} -> ${targets.length} destinatário(s)`);
    } catch (error: any) {
        log.error(`dispatchTaskNotification(${event}) task=${task?.id}`, error?.message || error);
    }
}
