/**
 * Lógica pura da camada 2 (sem I/O) — resolve papéis e calcula destinatários/canais.
 * Separada do taskNotificationService para ser testável sem carregar dolibarr/notificações.
 */
import type { TaskNotifEvent, TaskNotifRole, NotifChannel, TaskNotificationsConfig } from './uiConfigService';

// type_id (fk_c_type_contact) -> papel nesta instância do Dolibarr (validado: 45=Responsável, 46=Interveniente).
// Se a base mudar, ajustar aqui (ou expor o code no custom_sync).
export const TASK_CONTACT_TYPE_IDS: Record<'responsavel' | 'interveniente', string[]> = {
    responsavel: ['45'],
    interveniente: ['46'],
};

export interface RoleUsers {
    responsavel: string[];
    interveniente: string[];
    criador: string[];
}

export type TaskContact = { user_id?: string | number | null; type_id?: string | number | null };

const ROLES: TaskNotifRole[] = ['responsavel', 'interveniente', 'criador'];

/** Resolve os user_ids por papel a partir da tarefa (criador) + seus contatos (type_id). */
export function resolveRoleUsers(
    task: { fk_user_creat?: string | number | null },
    taskContacts: TaskContact[],
): RoleUsers {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));
    const byType = (ids: string[]) => uniq(
        (taskContacts || [])
            .filter((c) => c.user_id && ids.includes(String(c.type_id)))
            .map((c) => String(c.user_id)),
    );
    return {
        responsavel: byType(TASK_CONTACT_TYPE_IDS.responsavel),
        interveniente: byType(TASK_CONTACT_TYPE_IDS.interveniente),
        criador: task.fk_user_creat ? [String(task.fk_user_creat)] : [],
    };
}

/** Para um evento, calcula o conjunto de canais por usuário (une papéis quando a pessoa acumula mais de um). */
export function planTargets(
    event: TaskNotifEvent,
    roleUsers: RoleUsers,
    matrix: TaskNotificationsConfig,
): Array<{ userId: string; channels: NotifChannel[] }> {
    const perUser = new Map<string, Set<NotifChannel>>();
    ROLES.forEach((role) => {
        const channels = matrix[event]?.[role] || [];
        if (!channels.length) return;
        for (const userId of roleUsers[role]) {
            if (!perUser.has(userId)) perUser.set(userId, new Set());
            channels.forEach((ch) => perUser.get(userId)!.add(ch));
        }
    });
    return Array.from(perUser.entries()).map(([userId, set]) => ({ userId, channels: Array.from(set) }));
}
