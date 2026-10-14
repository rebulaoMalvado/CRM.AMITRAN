import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, MessageCircle, Search } from 'lucide-react';
import { Conversation, CONVERSATION_STATUS_LABEL } from '@/types/whatsapp';
import { Profile } from '@/types/crm';
import { conversationTitle, formatPhone, isWindowOpen } from '@/lib/whatsapp-utils';

export type ListFilter = 'todas' | 'sem_dono';

interface Props {
  conversations: Conversation[];
  profilesById: Map<string, Profile>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (s: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  isHead: boolean;
  unassignedCount: number;
  loading: boolean;
}

const ConversationList = ({
  conversations, profilesById, selectedId, onSelect, search, onSearch,
  filter, onFilter, isHead, unassignedCount, loading,
}: Props) => {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            placeholder="Buscar nome ou telefone..."
            value={search}
            onChange={e => onSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          />
        </div>
        {isHead && (
          <div className="flex gap-1.5">
            <button
              onClick={() => onFilter('todas')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${filter === 'todas' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground'}`}
            >
              Todas
            </button>
            <button
              onClick={() => onFilter('sem_dono')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${filter === 'sem_dono' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-card-foreground'}`}
            >
              Sem dono{unassignedCount > 0 ? ` (${unassignedCount})` : ''}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Nenhuma conversa por aqui ainda.
          </div>
        ) : (
          conversations.map(c => {
            const owner = c.assigned_seller_id ? profilesById.get(c.assigned_seller_id)?.name : null;
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`w-full text-left px-4 py-3 border-b border-border/60 transition-colors ${active ? 'bg-accent' : 'hover:bg-muted/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-card-foreground truncate">{conversationTitle(c)}</span>
                  {c.last_message_at && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatDistanceToNowStrict(new Date(c.last_message_at), { locale: ptBR })}
                    </span>
                  )}
                </div>
                {c.contact_name?.trim() && (
                  <div className="text-[11px] text-muted-foreground">{formatPhone(c.telefone_norm || c.wa_id)}</div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {!c.assigned_seller_id && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 text-warning">Sem dono</span>
                  )}
                  {owner && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">{owner}</span>
                  )}
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-info/10 text-info">
                    {CONVERSATION_STATUS_LABEL[c.status]}
                  </span>
                  {!isWindowOpen(c.last_inbound_at) && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">Janela 24h fechada</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ConversationList;
