import { Project, Task } from "../../types/projects";

export const getProjectActivity = (
    month: number,
    year: number,
    projects: Project[],
    tasks: Task[]
) => {
    const startDate = new Date(year, month - 1, 1).getTime() / 1000;
    const endDate = new Date(year, month, 0, 23, 59, 59).getTime() / 1000;

    // Active Projects (Start date before end of month AND (End date after start of month OR Open))
    const activeProjects = projects.filter(p => {
        let pStart = p.date_start || 0;
        let pEnd = p.date_end || 9999999999;

        if (typeof pStart === 'string') pStart = new Date(pStart).getTime() / 1000;
        if (typeof pEnd === 'string') pEnd = new Date(pEnd).getTime() / 1000;

        // Check overlap with month
        return pStart <= endDate && pEnd >= startDate && p.statut === '1'; // 1=Validated/Open
    });

    const tasksCompleted = tasks.filter(t => {
        let tEnd = t.date_end || t.tms || 0; // Use tms as backup for completion date
        if (typeof tEnd === 'string') tEnd = new Date(tEnd).getTime() / 1000;

        return t.progress === 100 && tEnd >= startDate && tEnd <= endDate;
    });

    const tasksCreated = tasks.filter(t => {
        let tStart = t.datec || 0;
        if (typeof tStart === 'string') tStart = new Date(tStart).getTime() / 1000;

        return tStart >= startDate && tStart <= endDate;
    });

    // Calculate progress velocity?
    const avgProgress = activeProjects.reduce((sum, p) => sum + (p.progress || 0), 0) / (activeProjects.length || 1);

    return {
        activeCount: activeProjects.length,
        tasksCreated: tasksCreated.length,
        tasksCompleted: tasksCompleted.length,
        avgProgress: avgProgress
    };
};
