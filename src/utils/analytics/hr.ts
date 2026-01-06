import { User, LeaveRequest } from "../../types/hr";

export const getTeamHealth = (
    month: number,
    year: number,
    users: User[],
    leaves: LeaveRequest[]
) => {
    const startDate = new Date(year, month - 1, 1).getTime() / 1000;
    const endDate = new Date(year, month, 0, 23, 59, 59).getTime() / 1000;

    // Active Users (simplified - total users enabled)
    const activeUsers = users.filter(u => u.statut === 1);

    // Leave Days in this month
    // Leave Days in this month
    const monthlyLeaves = leaves.filter(l => {
        // Check overlap: leave_start <= month_end AND leave_end >= month_start
        let lStart = l.date_debut;
        let lEnd = l.date_fin;

        if (typeof lStart === 'string') lStart = new Date(lStart).getTime() / 1000;
        if (typeof lEnd === 'string') lEnd = new Date(lEnd).getTime() / 1000;

        return lStart <= endDate && lEnd >= startDate && l.statut === '3'; // 3=Approved
    });

    const totalLeaveDays = monthlyLeaves.reduce((sum, l) => {
        // Simplified calculation. A proper one would intersect the ranges.
        return sum + 1; // Count requests for now, or calc duration if available
    }, 0);

    return {
        headcount: activeUsers.length,
        activeLeaves: monthlyLeaves.length,
        turnoverRate: 0 // Need historical user data to calc turnover
    };
};
