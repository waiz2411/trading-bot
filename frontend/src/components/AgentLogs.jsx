import React from 'react';
import { Terminal, Shield, CheckCircle, AlertTriangle, Info, Bot } from 'lucide-react';

export default function AgentLogs({ logs = [] }) {
  const getLogIcon = (type) => {
    switch (type) {
      case 'SUCCESS':
        return <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />;
      case 'WARN':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />;
      case 'ERROR':
        return <Shield className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />;
      default:
        return <Bot className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />;
    }
  };

  return (
    <div className="bg-terminal-850/70 border border-terminal-border rounded-xl overflow-hidden shadow-lg flex flex-col h-[380px]">
      <div className="p-3 border-b border-terminal-border flex items-center justify-between bg-terminal-900/50">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
            Agent Reasoning & Event Stream
          </h2>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          Neural Engine Live
        </span>
      </div>

      <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-2 bg-terminal-950/50">
        {logs.length === 0 ? (
          <div className="text-center text-slate-500 py-10">
            Awaiting first agent scan cycle...
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start space-x-2 text-slate-300 hover:text-white transition-colors"
            >
              {getLogIcon(log.type)}
              <span className="text-slate-500 text-[11px] shrink-0 font-mono">[{log.time}]</span>
              <span className="leading-relaxed break-words text-slate-300">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
