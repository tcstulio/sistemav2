import React, { useState } from 'react';
import { CentroVibeService } from '../../services/centrovibeService';
import { CompatibilityResult } from '../../types/centrovibe';
import { Card, Input, Button } from '../ui';
import { Flame, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

const VibeCheck: React.FC = () => {
  const [genreA, setGenreA] = useState('');
  const [genreB, setGenreB] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompatibilityResult | null>(null);

  const handleCheck = async () => {
    if (!genreA || !genreB) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await CentroVibeService.checkVibeCompatibility(genreA, genreB);
      setResult(data);
    } catch {
      setResult({
        isCompatible: false,
        score: 0,
        reasoning: 'Falha na conexão com o advisor.',
        suggestion: 'Tente novamente.'
      });
    }
    setLoading(false);
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Flame className="text-indigo-500" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Vibe Check AI</h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Vai misturar dois estilos na mesma noite? Pergunte à IA se o público do Centro aprova a mistura.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Input
          label="Estilo 1"
          placeholder="Ex: Pagode 90"
          value={genreA}
          onChange={(e) => setGenreA(e.target.value)}
        />
        <Input
          label="Estilo 2"
          placeholder="Ex: Techno Dark"
          value={genreB}
          onChange={(e) => setGenreB(e.target.value)}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        loading={loading}
        disabled={!genreA || !genreB}
        onClick={handleCheck}
      >
        Verificar Compatibilidade
      </Button>

      {result && (
        <div className={`mt-6 p-4 rounded-xl border ${result.isCompatible ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900' : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'}`}>
          <div className="flex items-center gap-3 mb-3">
            {result.isCompatible ? (
              <CheckCircle className="text-emerald-500 h-6 w-6" />
            ) : (
              <XCircle className="text-red-500 h-6 w-6" />
            )}
            <span className={`text-lg font-bold ${result.isCompatible ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {result.score}% Match
            </span>
          </div>
          <p className="text-slate-700 dark:text-slate-300 text-sm mb-2">{result.reasoning}</p>
          <div className="flex items-start gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-800/50">
            <AlertTriangle className="text-amber-500 h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-amber-700 dark:text-amber-200/80 text-xs italic">{result.suggestion}</p>
          </div>
        </div>
      )}
    </Card>
  );
};

export default VibeCheck;
