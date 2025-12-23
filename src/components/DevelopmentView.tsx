import React, { useState } from 'react';
import { Terminal, Activity, Stethoscope, List, Play, Shield, Key, Sparkles, Code, Zap } from 'lucide-react';
import { ApiLog } from '../types';
import { useDolibarr } from '../context/DolibarrContext';
import { MonitorTab } from './DevelopmentConsole/MonitorTab';
import { AuditTab } from './DevelopmentConsole/AuditTab';
import { ConsoleLogsTab } from './DevelopmentConsole/ConsoleLogsTab';
import { PlaygroundTab } from './DevelopmentConsole/PlaygroundTab';
import { AiFixTab } from './DevelopmentConsole/AiFixTab';
import { CodegenTab } from './DevelopmentConsole/CodegenTab';
import { OptimizeTab } from './DevelopmentConsole/OptimizeTab';
import { PermissionsTab } from './DevelopmentConsole/PermissionsTab';
import { CoverageTab } from './DevelopmentConsole/CoverageTab';
import { LlmSettingsTab } from './DevelopmentConsole/LlmSettingsTab';

const DevelopmentView: React.FC = () => {
    const { config } = useDolibarr();

    const [activeTab, setActiveTab] = useState<'audit' | 'console' | 'coverage' | 'playground' | 'ai_fix' | 'codegen' | 'optimize' | 'monitor' | 'permissions' | 'llm'>('monitor');
    const [selectedLogForAnalysis, setSelectedLogForAnalysis] = useState<ApiLog | null>(null);

    const handleAnalyzeError = (log: ApiLog) => {
        setSelectedLogForAnalysis(log);
        setActiveTab('ai_fix');
    };

    if (!config) {
        return <div className="p-10 text-center text-slate-400">Carregando configurações...</div>;
    }

    const themeColor = config.themeColor || 'indigo';

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 transition-colors">
            {/* Header */}
            <div className="p-4 md:p-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-none">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Terminal className={`text-${themeColor}-600`} /> Console de Desenvolvedor
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Diagnósticos do sistema e ferramentas de API</p>
                    </div>
                    <button
                        onClick={() => window.location.href = '/admin'}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors shadow-sm text-sm"
                    >
                        <Shield size={16} /> Console Admin
                    </button>
                </div>

                <div className="flex gap-1 overflow-x-auto border-b border-slate-100 dark:border-slate-800 pb-1">
                    {[
                        { id: 'monitor', label: 'Monitor de Sync', icon: Activity },
                        { id: 'audit', label: 'Auditoria do Sistema', icon: Stethoscope },
                        { id: 'console', label: 'Logs de API', icon: List },
                        { id: 'playground', label: 'API Playground', icon: Play },
                        { id: 'coverage', label: 'Cobertura API', icon: Shield },
                        { id: 'permissions', label: 'Permissões', icon: Key },
                        { id: 'ai_fix', label: 'Auto-Reparo', icon: Sparkles },
                        { id: 'llm', label: 'Config IA', icon: Zap },
                        { id: 'codegen', label: 'Gerar Código', icon: Code },
                        { id: 'optimize', label: 'Otimização', icon: Zap },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.id ? `bg-${themeColor}-50 text-${themeColor}-700 dark:bg-${themeColor}-900/20 dark:text-${themeColor}-300` : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        >
                            <tab.icon size={16} /> {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'monitor' && <MonitorTab />}

                {activeTab === 'audit' && (
                    <AuditTab />
                )}

                {activeTab === 'console' && (
                    <ConsoleLogsTab onAnalyzeError={handleAnalyzeError} />
                )}

                {activeTab === 'playground' && (
                    <PlaygroundTab config={config} />
                )}

                {activeTab === 'ai_fix' && (
                    <AiFixTab selectedLog={selectedLogForAnalysis} />
                )}

                {activeTab === 'codegen' && <CodegenTab />}

                {activeTab === 'optimize' && (
                    <OptimizeTab logs={[]} />
                )}

                {activeTab === 'permissions' && <PermissionsTab />}

                {activeTab === 'coverage' && <CoverageTab />}

                {activeTab === 'llm' && <LlmSettingsTab />}
            </div>
        </div>
    );
};

export default DevelopmentView;
