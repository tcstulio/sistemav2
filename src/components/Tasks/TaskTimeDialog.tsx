import React, { useState } from 'react';
import { Task } from '../../types/projects';
import { useDolibarr } from '../../context/DolibarrContext';
import { dbService } from '../../services/dbService'; // Import dbService
import { X, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface TaskTimeDialogProps {
    task: Task;
    isOpen: boolean;
    onClose: () => void;
}

export const TaskTimeDialog: React.FC<TaskTimeDialogProps> = ({ task, isOpen, onClose }) => {
    // const { add } = useDolibarr(); // REMOVED
    const [duration, setDuration] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [startTime, setStartTime] = useState(''); // New state for time
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Duration parsing: simple check for now (hours)
        // User enters "1.5" or "1:30"
        let seconds = 0;
        if (duration.includes(':')) {
            const [h, m] = duration.split(':').map(Number);
            seconds = (h * 3600) + (m * 60);
        } else {
            seconds = parseFloat(duration) * 3600;
        }

        if (isNaN(seconds) || seconds <= 0) {
            toast.error("Duração inválida");
            return;
        }

        setLoading(true);
        try {
            // Calculate final timestamp
            // If time is provided, combine date + time. Else, use noon or just date.
            const dateTimeString = startTime ? `${date}T${startTime}:00` : `${date}T00:00:00`;
            const dateTimestamp = new Date(dateTimeString).getTime() / 1000;

            const timeLog = {
                id: `TEMP_${Date.now()}`,
                task_id: task.id,
                date: dateTimestamp,
                // We send 'date' as the start timestamp. Dolibarr should map this to element_datehour if configured properly.
                // Our frontend mapper maps this back to 'date' and optionally 'date_start'
                duration: seconds,
                note: note,
                date_modification: Date.now() / 1000,
                // user_id omitted, backend should assign current user or we fetch from context
            };

            await dbService.add('taskTimeLogs', timeLog);
            toast.success("Tempo registrado com sucesso!");
            onClose();
        } catch (error) {
            console.error(error);
            toast.error("Erro ao registrar tempo");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                        <Clock className="w-5 h-5 text-indigo-600" />
                        Registrar Tempo
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Tarefa
                        </label>
                        <div className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                            {task.label}
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Data
                            </label>
                            <input
                                type="date"
                                required
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Início (Opcional)
                            </label>
                            <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Duração (horas)
                            </label>
                            <input
                                type="text"
                                required
                                placeholder="ex: 1.5 ou 1:30"
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Nota (Opcional)
                        </label>
                        <textarea
                            rows={3}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                            placeholder="Descreva o que foi feito..."
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-medium transition-colors disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="animate-spin w-4 h-4" /> : 'Registrar'}
                        </button>
                    </div>
                </form>
            </div >
        </div >
    );
};
