import { describe, it, expect } from 'vitest';
import { resolveRoleUsers, planTargets, TASK_CONTACT_TYPE_IDS } from '../../services/taskNotificationLogic';

describe('taskNotificationService — lógica pura (camada 2)', () => {
    const task = { fk_user_creat: '10' };
    const contacts = [
        { user_id: '7', type_id: '45' }, // responsável
        { user_id: '8', type_id: '45' }, // responsável (2º)
        { user_id: '9', type_id: '46' }, // interveniente
        { user_id: '7', type_id: '46' }, // 7 também é interveniente
    ];

    it('resolveRoleUsers separa por papel; criador vem de fk_user_creat', () => {
        const r = resolveRoleUsers(task, contacts);
        expect(r.responsavel.sort()).toEqual(['7', '8']);
        expect(r.interveniente.sort()).toEqual(['7', '9']);
        expect(r.criador).toEqual(['10']);
    });

    it('resolveRoleUsers sem contatos -> só criador', () => {
        const r = resolveRoleUsers(task, []);
        expect(r.responsavel).toEqual([]);
        expect(r.interveniente).toEqual([]);
        expect(r.criador).toEqual(['10']);
    });

    const matrix: any = {
        overdue: { responsavel: ['in-app', 'whatsapp'], interveniente: [], criador: ['email'] },
        completed: { responsavel: [], interveniente: ['in-app'], criador: ['in-app'] },
        assigned: { responsavel: ['whatsapp'], interveniente: [], criador: [] },
        deadline_reminder: { responsavel: [], interveniente: [], criador: [] },
        stalled: { responsavel: [], interveniente: [], criador: [] },
        comment: { responsavel: [], interveniente: [], criador: [] },
    };

    it('planTargets aplica a matriz por papel', () => {
        const roleUsers = { responsavel: ['7'], interveniente: ['9'], criador: ['10'] };
        const byUser = Object.fromEntries(planTargets('overdue', roleUsers, matrix).map((x) => [x.userId, x.channels.sort()]));
        expect(byUser['7']).toEqual(['in-app', 'whatsapp']); // responsável
        expect(byUser['9']).toBeUndefined();                  // interveniente sem canais no overdue
        expect(byUser['10']).toEqual(['email']);              // criador
    });

    it('planTargets une canais quando a pessoa acumula papéis', () => {
        const roleUsers = { responsavel: ['7'], interveniente: ['7'], criador: [] };
        const m: any = { completed: { responsavel: ['whatsapp'], interveniente: ['in-app'], criador: [] } };
        const t = planTargets('completed', roleUsers, m);
        expect(t).toHaveLength(1);
        expect(t[0].userId).toBe('7');
        expect(t[0].channels.sort()).toEqual(['in-app', 'whatsapp']);
    });

    it('mapeamento type_id (45=Responsável, 46=Interveniente)', () => {
        expect(TASK_CONTACT_TYPE_IDS.responsavel).toContain('45');
        expect(TASK_CONTACT_TYPE_IDS.interveniente).toContain('46');
    });
});
