import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Camera, Coffee, Ticket, Calendar } from 'lucide-react';
import { CentroVibeService } from '../../services/centrovibeService';
import { CentroVibeMessage } from '../../types/centrovibe';
import { Modal, Button } from '../ui';

const SUGGESTIONS = [
  { icon: Camera, label: "Legenda p/ Instagram", text: "Crie uma legenda de Instagram chamativa e com emojis para divulgar o Baile Hype de Sábado à noite, focada no público jovem." },
  { icon: Coffee, label: "Sugestão de Drinks", text: "Me dê 3 sugestões de drinks criativos e baratos para vender na noite de Terça Latina (Reggaeton)." },
  { icon: Ticket, label: "Estratégia de Preço", text: "Qual seria uma boa estratégia de preço de ingressos para a Sexta Open Format para garantir casa cheia cedo?" },
  { icon: Calendar, label: "Ideia para Domingo", text: "Me dê uma ideia de evento para Domingo à tarde que combine com área verde e comida." },
];

interface AssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AssistantModal: React.FC<AssistantModalProps> = ({ isOpen, onClose }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CentroVibeMessage[]>([
    { role: 'model', text: 'Olá! Sou seu Gerente Virtual. Posso ajudar com Marketing (legendas), Operações (cardápio/drinks) ou Estratégia de Agenda. O que vamos planejar hoje?' }
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (text: string = input) => {
    if (!text.trim()) return;

    const userMsg: CentroVibeMessage = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const responseText = await CentroVibeService.chatWithAdvisor(text, messages);
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch {
      setMessages(prev => [...prev, { role: 'model', text: 'Estou tendo problemas de conexão. Tente novamente.' }]);
    }
    setLoading(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-indigo-600 rounded-lg">
            <Sparkles className="text-white h-4 w-4" />
          </div>
          <div>
            <span className="font-bold">CentroVibe Advisor</span>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-normal">Marketing & Operações</p>
          </div>
        </div>
      }
      size="lg"
      footer={
        <div className="flex gap-2 w-full">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Digite sua dúvida ou ideia..."
            className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <Button
            variant="primary"
            icon={<Send size={18} />}
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
          />
        </div>
      }
    >
      <div className="space-y-4 min-h-[40vh]">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-200 dark:bg-slate-700' : 'bg-indigo-100 dark:bg-indigo-900'}`}>
                {msg.role === 'user' ? <User size={14} className="text-slate-600 dark:text-slate-300" /> : <Bot size={14} className="text-indigo-600 dark:text-indigo-400" />}
              </div>
              <div className={`p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white rounded-tr-none'
                  : 'bg-indigo-50 dark:bg-indigo-900/20 text-slate-700 dark:text-indigo-100 border border-indigo-200 dark:border-indigo-800/30 rounded-tl-none'
              }`}>
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        {messages.length < 3 && !loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
            {SUGGESTIONS.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(suggestion.text)}
                className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/50 hover:border-indigo-300 dark:hover:border-indigo-500/50 rounded-xl transition-all text-left group"
              >
                <div className="p-2 bg-white dark:bg-slate-900 rounded-lg text-indigo-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors border border-slate-200 dark:border-slate-700">
                  <suggestion.icon size={18} />
                </div>
                <div>
                  <span className="block text-sm font-bold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">{suggestion.label}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">Clique para enviar</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[80%]">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center shrink-0">
                <Bot size={14} className="text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/30 rounded-tl-none flex items-center gap-2">
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:75ms]" />
                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </Modal>
  );
};

export default AssistantModal;
