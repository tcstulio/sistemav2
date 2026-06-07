import { createLogger } from '../utils/logger';
import { dolibarrService } from './dolibarr';
import { notificationService, NotificationEvent } from './notificationService';
import { renderTemplate } from './notificationTemplates';

const log = createLogger('AlertCron');

interface AlertCache {
    [key: string]: number;
}

class AlertCronService {
    private intervals: NodeJS.Timeout[] = [];
    private alerted: AlertCache = {};
    private running = false;

    start() {
        if (this.running) return;
        this.running = true;

        this.schedule(24 * 60 * 60 * 1000, () => {
            this.checkOverdueInvoices().catch(e => log.error('checkOverdueInvoices', e));
            this.checkUpcomingInvoices().catch(e => log.error('checkUpcomingInvoices', e));
            this.checkOverdueTasks().catch(e => log.error('checkOverdueTasks', e));
        });

        this.schedule(6 * 60 * 60 * 1000, () => {
            this.checkLowStock().catch(e => log.error('checkLowStock', e));
        });

        this.schedule(4 * 60 * 60 * 1000, () => {
            this.checkStaleTickets().catch(e => log.error('checkStaleTickets', e));
        });

        log.info('AlertCronService started (24h invoices, 6h stock, 4h tickets)');
    }

    stop() {
        this.intervals.forEach(clearInterval);
        this.intervals = [];
        this.running = false;
        log.info('AlertCronService stopped');
    }

    private schedule(ms: number, fn: () => void) {
        setTimeout(() => fn(), 2 * 60 * 1000);
        this.intervals.push(setInterval(fn, ms));
    }

    private dedupKey(prefix: string, id: string): string {
        return `${prefix}:${id}`;
    }

    private wasAlertedToday(key: string): boolean {
        const last = this.alerted[key];
        if (!last) return false;
        const now = new Date();
        const lastDate = new Date(last);
        return now.toDateString() === lastDate.toDateString();
    }

    private markAlerted(key: string) {
        this.alerted[key] = Date.now();
        const keys = Object.keys(this.alerted);
        if (keys.length > 500) {
            const cutoff = Date.now() - 48 * 60 * 60 * 1000;
            for (const k of keys) {
                if (this.alerted[k] < cutoff) delete this.alerted[k];
            }
        }
    }

    private async notify(event: NotificationEvent, title: string, message: string, entityType?: string, entityId?: string) {
        await notificationService.create({
            event,
            title,
            message,
            channels: ['in-app'],
            priority: 'high',
            entityType,
            entityId,
            senderName: 'Sistema',
        });
    }

    async checkOverdueInvoices() {
        try {
            const invoices = await dolibarrService.listInvoices({ status: 'unpaid', limit: 100 });
            const now = new Date();
            const today = now.getTime() / 1000;

            const overdue = invoices.filter((inv: any) => {
                const deadline = inv.date_limite || inv.date_validity;
                if (!deadline) return false;
                return deadline < today;
            });

            if (overdue.length === 0) return;

            const dedupKey = this.dedupKey('overdue_inv', 'daily');
            if (this.wasAlertedToday(dedupKey)) return;

            const total = overdue.reduce((sum: number, inv: any) => sum + parseFloat(inv.total_ttc || '0'), 0);
            const message = overdue.length <= 5
                ? overdue.map((inv: any) => `${inv.ref} — R$ ${parseFloat(inv.total_ttc || '0').toFixed(2)}`).join('\n')
                : renderTemplate('invoice.overdue', 'in-app', {
                    count: String(overdue.length),
                    total: `R$ ${total.toFixed(2)}`,
                });

            await this.notify(
                'invoice.overdue',
                `${overdue.length} fatura(s) vencida(s) — Total: R$ ${total.toFixed(2)}`,
                message || `${overdue.length} faturas vencidas. Total: R$ ${total.toFixed(2)}`,
                'invoice',
                overdue.map((inv: any) => inv.ref).join(','),
            );

            this.markAlerted(dedupKey);
            log.info(`Alert: ${overdue.length} overdue invoices (R$ ${total.toFixed(2)})`);
        } catch (e) {
            log.error('checkOverdueInvoices error', e);
        }
    }

    async checkUpcomingInvoices() {
        try {
            const invoices = await dolibarrService.listInvoices({ status: 'unpaid', limit: 100 });
            const now = new Date();
            const in3Days = (now.getTime() + 3 * 24 * 60 * 60 * 1000) / 1000;
            const today = now.getTime() / 1000;

            const upcoming = invoices.filter((inv: any) => {
                const deadline = inv.date_limite || inv.date_validity;
                if (!deadline) return false;
                return deadline > today && deadline <= in3Days;
            });

            if (upcoming.length === 0) return;

            const dedupKey = this.dedupKey('upcoming_inv', 'daily');
            if (this.wasAlertedToday(dedupKey)) return;

            const message = upcoming
                .slice(0, 10)
                .map((inv: any) => {
                    const deadline = inv.date_limite || inv.date_validity;
                    const dateStr = deadline ? new Date(deadline * 1000).toLocaleDateString('pt-BR') : '?';
                    return `${inv.ref} — R$ ${parseFloat(inv.total_ttc || '0').toFixed(2)} (vence ${dateStr})`;
                })
                .join('\n');

            await this.notify(
                'invoice.overdue',
                `${upcoming.length} fatura(s) vencendo em até 3 dias`,
                message,
                'invoice',
                upcoming.map((inv: any) => inv.ref).join(','),
            );

            this.markAlerted(dedupKey);
            log.info(`Alert: ${upcoming.length} upcoming invoices`);
        } catch (e) {
            log.error('checkUpcomingInvoices error', e);
        }
    }

    async checkLowStock() {
        try {
            const products = await dolibarrService.listProducts();
            if (!products || products.length === 0) return;

            const lowStock = products.filter((p: any) => {
                const threshold = parseFloat(p.seuil_stock_alerte || '0');
                const actual = parseFloat(p.stock_reel || '0');
                return threshold > 0 && actual < threshold;
            });

            if (lowStock.length === 0) return;

            const newAlerts: any[] = [];
            for (const p of lowStock) {
                const key = this.dedupKey('stock', String(p.id || p.rowid));
                if (!this.wasAlertedToday(key)) {
                    newAlerts.push(p);
                    this.markAlerted(key);
                }
            }

            if (newAlerts.length === 0) return;

            const message = newAlerts
                .slice(0, 10)
                .map((p: any) => `${p.ref || p.label}: restam ${p.stock_reel} (mín: ${p.seuil_stock_alerte})`)
                .join('\n');

            await this.notify(
                'stock.low',
                `${newAlerts.length} produto(s) com estoque baixo`,
                message,
                'product',
                newAlerts.map((p: any) => String(p.id || p.rowid)).join(','),
            );

            log.info(`Alert: ${newAlerts.length} low stock products`);
        } catch (e) {
            log.error('checkLowStock error', e);
        }
    }

    async checkOverdueTasks() {
        try {
            const tasks = await dolibarrService.listTasks();
            if (!tasks || tasks.length === 0) return;

            const now = new Date();
            const today = now.getTime() / 1000;

            const overdue = tasks.filter((t: any) => {
                const deadline = t.date_end || t.datee;
                if (!deadline) return false;
                const progress = parseFloat(t.progress || '0');
                return deadline < today && progress < 100;
            });

            if (overdue.length === 0) return;

            const dedupKey = this.dedupKey('overdue_tasks', 'daily');
            if (this.wasAlertedToday(dedupKey)) return;

            const message = overdue
                .slice(0, 10)
                .map((t: any) => `${t.ref || t.rowid}: ${t.label} (${t.progress || 0}%)`)
                .join('\n');

            await this.notify(
                'custom',
                `${overdue.length} tarefa(s) atrasada(s)`,
                message,
                'task',
                overdue.map((t: any) => String(t.id || t.rowid)).join(','),
            );

            this.markAlerted(dedupKey);
            log.info(`Alert: ${overdue.length} overdue tasks`);
        } catch (e) {
            log.error('checkOverdueTasks error', e);
        }
    }

    async checkStaleTickets() {
        try {
            const tickets = await dolibarrService.listTickets({ limit: 50 });
            if (!tickets || tickets.length === 0) return;

            const now = Date.now() / 1000;
            const staleHours = 24;

            const stale = tickets.filter((t: any) => {
                const created = t.datec || t.date_creation;
                if (!created) return false;
                const status = t.fk_statut || t.status;
                if (status === '6' || status === '8') return false;
                return (now - created) > staleHours * 3600;
            });

            if (stale.length === 0) return;

            const newAlerts: any[] = [];
            for (const t of stale) {
                const key = this.dedupKey('stale_ticket', String(t.id || t.rowid || t.track_id));
                if (!this.wasAlertedToday(key)) {
                    newAlerts.push(t);
                    this.markAlerted(key);
                }
            }

            if (newAlerts.length === 0) return;

            const message = newAlerts
                .slice(0, 10)
                .map((t: any) => `${t.track_id || t.ref}: ${t.subject || 'Sem assunto'}`)
                .join('\n');

            await this.notify(
                'ticket.created',
                `${newAlerts.length} ticket(s) sem resposta há +24h`,
                message,
                'ticket',
                newAlerts.map((t: any) => String(t.id || t.rowid)).join(','),
            );

            log.info(`Alert: ${newAlerts.length} stale tickets`);
        } catch (e) {
            log.error('checkStaleTickets error', e);
        }
    }
}

export const alertCronService = new AlertCronService();
