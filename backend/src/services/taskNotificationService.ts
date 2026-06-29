/**
 * Task Notification Service (camada 2) — dispara as notificações de eventos de tarefa para os
 * envolvidos, conforme a matriz [evento × papel × canal] do UiConfigService.
 * A lógica pura (papéis/canais) fica em taskNotificationLogic (testável sem I/O).
 */
import { dolibarrService } from './dolibarrService';
import { notificationService, NotificationChannel, NotificationEvent } from './notificationService';
import { uiConfigService, TaskNotifEvent } from './uiConfigService';
import { renderTaskTemplate } from './notificationTemplates';
import { resolveRoleUsers, planTargets, TaskContact } from './taskNotificationLogic';
import { createLogger } from '../utils/logger';

const log = createLogger('TaskNotifications');

export { resolveRoleUsers, planTargets, TASK_CONTACT_TYPE_IDS } from './taskNotificationLogic';

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
        const targets = planTargets(event, roleUsers, cfg.taskNotifications)
            // trava de segurança: sem canais externos habilitados, só in-app sai (testável no webapp).
            .map((t) => ({ userId: t.userId, channels: externalOn ? t.channels : t.channels.filter((c) => c === 'in-app') }))
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
                recipientPhone: user?.phone_mobile || user?.user_mobile || user?.office_phone || undefined,
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
