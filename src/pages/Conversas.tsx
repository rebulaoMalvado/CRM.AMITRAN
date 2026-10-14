import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FlaskConical, LogOut, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Profile } from '@/types/crm';
import { Conversation, SdrConfig, WhatsappMessage } from '@/types/whatsapp';
import { assignConversation, sendWhatsappFile, sendWhatsappMessage, setConversationAi, setSdrConfig } from '@/lib/whatsapp-api';
import { conversationTitle } from '@/lib/whatsapp-utils';
import ConversationList, { ListFilter } from '@/components/conversas/ConversationList';
import MessageThread from '@/components/conversas/MessageThread';
import SdrPanel from '@/components/conversas/SdrPanel';
import SimulatorModal from '@/components/conversas/SimulatorModal';

// A tela atualiza sozinha por consulta periódica (sem mexer no banco).
// Quem pode ver o quê é decidido pelo banco (RLS): vendedor só vê as conversas dele, Head vê todas.
const LIST_REFRESH_MS = 8_000;
const THREAD_REFRESH_MS = 4_000;

const Conversas = () => {
  const { profile, isHead, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>('todas');
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Vindo de um negócio ("Ir para a conversa"): /conversas?conversa=<id> abre direto a conversa.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('conversa');
    if (id) setSelectedId(id);
  }, [searchParams]);

  const conversationsQ = useQuery({
    queryKey: ['wa-conversations'],
    refetchInterval: LIST_REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_conversations')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Conversation[];
    },
  });

  const profilesQ = useQuery({
    queryKey: ['wa-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  // Config da IA: só o Head consegue ler (RLS); para vendedor a consulta volta vazia.
  const sdrQ = useQuery({
    queryKey: ['wa-sdr-config'],
    enabled: isHead,
    refetchInterval: LIST_REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.from('crm_sdr_config').select('ai_enabled, mode').eq('id', 1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as SdrConfig | null;
    },
  });

  const messagesQ = useQuery({
    queryKey: ['wa-messages', selectedId],
    enabled: !!selectedId,
    refetchInterval: THREAD_REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_messages')
        .select('*')
        .eq('conversation_id', selectedId as string)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as WhatsappMessage[];
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => sendWhatsappMessage(id, text),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-messages'] });
      queryClient.invalidateQueries({ queryKey: ['wa-conversations'] });
    },
  });

  const sendFileMutation = useMutation({
    mutationFn: ({ id, file, caption }: { id: string; file: File; caption: string }) => sendWhatsappFile(id, file, caption),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-messages'] });
      queryClient.invalidateQueries({ queryKey: ['wa-conversations'] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, sellerId }: { id: string; sellerId: string | null }) => assignConversation(id, sellerId),
    onSuccess: () => {
      toast.success('Responsável atualizado');
      queryClient.invalidateQueries({ queryKey: ['wa-conversations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sdrMutation = useMutation({
    mutationFn: (enabled: boolean) => setSdrConfig({ ai_enabled: enabled }),
    onSuccess: (_d, enabled) => {
      toast.success(enabled ? 'IA ligada (modo sombra)' : 'IA desligada');
      queryClient.invalidateQueries({ queryKey: ['wa-sdr-config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sdrModeMutation = useMutation({
    mutationFn: (mode: 'shadow' | 'auto') => setSdrConfig({ mode }),
    onSuccess: (_d, mode) => {
      toast.success(mode === 'auto' ? 'Modo automático ativado (só números liberados)' : 'Modo sombra ativado');
      queryClient.invalidateQueries({ queryKey: ['wa-sdr-config'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conversationAiMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => setConversationAi(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wa-conversations'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const profilesById = useMemo(() => new Map((profilesQ.data ?? []).map(p => [p.id, p])), [profilesQ.data]);
  const sellers = useMemo(() => (profilesQ.data ?? []).filter(p => p.role === 'vendedor'), [profilesQ.data]);

  const all = conversationsQ.data ?? [];
  const unassignedCount = all.filter(c => !c.assigned_seller_id).length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(c => {
      if (filter === 'sem_dono' && c.assigned_seller_id) return false;
      if (!term) return true;
      const digits = term.replace(/\D/g, '');
      return (
        conversationTitle(c).toLowerCase().includes(term) ||
        (digits.length > 0 && (c.telefone_norm.includes(digits) || c.wa_id.includes(digits)))
      );
    });
  }, [all, search, filter]);

  const selected = all.find(c => c.id === selectedId) ?? null;

  const handleSend = async (text: string): Promise<boolean> => {
    if (!selected) return false;
    try {
      await sendMutation.mutateAsync({ id: selected.id, text });
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  const handleSendFile = async (file: File, caption: string): Promise<boolean> => {
    if (!selected) return false;
    try {
      await sendFileMutation.mutateAsync({ id: selected.id, file, caption });
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-background">
      {/* No celular, dentro de uma conversa o cabeçalho da página some: só o nome e as infos do cliente (a seta volta para a lista). */}
      <header className={`shrink-0 bg-card/80 backdrop-blur-xl border-b border-border ${selected ? 'hidden md:block' : ''}`}>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 rounded-md hover:bg-muted transition-colors" aria-label="Voltar ao CRM">
              <ArrowLeft className="w-4 h-4 text-muted-foreground" />
            </Link>
            <div>
              <h1 className="text-base font-bold text-card-foreground tracking-tight">Conversas</h1>
              <p className="text-[11px] text-muted-foreground">
                {profile?.name} · {isHead ? 'Head de Vendas' : 'Vendedor'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            {isHead && (
              <div className={selected ? 'hidden md:block' : ''}>
                <SdrPanel config={sdrQ.data ?? null} busy={sdrMutation.isPending || sdrModeMutation.isPending} onToggle={enabled => sdrMutation.mutate(enabled)} onModeChange={mode => sdrModeMutation.mutate(mode)} />
              </div>
            )}
          {isHead && (
            <button
              onClick={() => setSimulatorOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
              title="Conversar com a Carol sem gravar nada nem mandar WhatsApp"
            >
              <FlaskConical className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Testar Carol</span>
            </button>
          )}
          <button
            onClick={signOut}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Sair</span>
          </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 w-full max-w-[1600px] mx-auto md:px-6 md:py-4">
        <div className="h-full md:rounded-xl md:border md:border-border bg-card overflow-hidden md:grid md:grid-cols-[360px_1fr]">
          <aside className={`h-full min-h-0 md:border-r md:border-border ${selected ? 'hidden md:block' : 'block'}`}>
            <ConversationList
              conversations={visible}
              profilesById={profilesById}
              selectedId={selectedId}
              onSelect={setSelectedId}
              search={search}
              onSearch={setSearch}
              filter={filter}
              onFilter={setFilter}
              isHead={isHead}
              unassignedCount={unassignedCount}
              loading={conversationsQ.isLoading}
            />
          </aside>

          <section className={`h-full min-h-0 ${selected ? 'block' : 'hidden md:block'}`}>
            {selected ? (
              <MessageThread
                conversation={selected}
                messages={messagesQ.data ?? []}
                loading={messagesQ.isLoading}
                isHead={isHead}
                sellers={sellers}
                ownerName={selected.assigned_seller_id ? profilesById.get(selected.assigned_seller_id)?.name ?? null : null}
                sending={sendMutation.isPending || sendFileMutation.isPending}
                onSendFile={handleSendFile}
                assigning={assignMutation.isPending}
                onBack={() => setSelectedId(null)}
                onSend={handleSend}
                onAssign={sellerId => assignMutation.mutate({ id: selected.id, sellerId })}
                canToggleAi={isHead || selected.assigned_seller_id === profile?.id}
                aiBusy={conversationAiMutation.isPending}
                onToggleAi={enabled => conversationAiMutation.mutate({ id: selected.id, enabled })}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                <MessageCircle className="w-10 h-10 opacity-30" />
                <p className="text-sm">Selecione uma conversa para ver as mensagens.</p>
              </div>
            )}
          </section>
        </div>
      </main>
      {simulatorOpen && <SimulatorModal onClose={() => setSimulatorOpen(false)} />}
    </div>
  );
};

export default Conversas;
