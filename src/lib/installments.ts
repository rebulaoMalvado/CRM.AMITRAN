import { supabase } from '@/lib/supabase';
import { DealInstallment, DealInstallmentDraft, InstallmentWithDeal, Profile } from '@/types/crm';

type InstallmentRow = {
  id: string;
  deal_id: string;
  installment_number: number;
  amount: number | string;
  due_date: string;
  is_received: boolean;
  received_date: string | null;
  received_amount: number | string | null;
  created_at: string;
  updated_at: string;
};

function rowToInstallment(row: InstallmentRow): DealInstallment {
  return {
    id: row.id,
    dealId: row.deal_id,
    installmentNumber: row.installment_number,
    amount: Number(row.amount) || 0,
    dueDate: row.due_date,
    isReceived: row.is_received,
    receivedDate: row.received_date || undefined,
    receivedAmount: row.received_amount != null ? Number(row.received_amount) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchInstallmentsByDeal(dealId: string): Promise<DealInstallment[]> {
  const { data, error } = await supabase
    .from('deal_installments')
    .select('*')
    .eq('deal_id', dealId)
    .order('installment_number', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => rowToInstallment(r as InstallmentRow));
}

/**
 * Persiste o estado das parcelas: deleta as removidas, atualiza as existentes e
 * insere as novas. As parcelas são reenumeradas pela ordem do array.
 */
export async function saveInstallments(
  dealId: string,
  drafts: DealInstallmentDraft[],
  deletedIds: string[]
): Promise<void> {
  if (deletedIds.length > 0) {
    const { error } = await supabase.from('deal_installments').delete().in('id', deletedIds);
    if (error) throw error;
  }

  const toInsert = drafts
    .map((d, idx) => ({ d, number: idx + 1 }))
    .filter(({ d }) => !d.id)
    .map(({ d, number }) => ({
      deal_id: dealId,
      installment_number: number,
      amount: d.amount,
      due_date: d.dueDate,
      is_received: d.isReceived,
      received_date: d.receivedDate || null,
      received_amount: d.receivedAmount ?? null,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('deal_installments').insert(toInsert);
    if (error) throw error;
  }

  const toUpdate = drafts
    .map((d, idx) => ({ d, number: idx + 1 }))
    .filter(({ d }) => !!d.id);

  for (const { d, number } of toUpdate) {
    const { error } = await supabase
      .from('deal_installments')
      .update({
        installment_number: number,
        amount: d.amount,
        due_date: d.dueDate,
        is_received: d.isReceived,
        received_date: d.receivedDate || null,
        received_amount: d.receivedAmount ?? null,
      })
      .eq('id', d.id!);
    if (error) throw error;
  }
}

export async function markInstallmentReceived(
  id: string,
  receivedDate: string,
  receivedAmount: number
): Promise<DealInstallment> {
  const { data, error } = await supabase
    .from('deal_installments')
    .update({
      is_received: true,
      received_date: receivedDate,
      received_amount: receivedAmount,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToInstallment(data as InstallmentRow);
}

export async function unmarkInstallmentReceived(id: string): Promise<DealInstallment> {
  const { data, error } = await supabase
    .from('deal_installments')
    .update({
      is_received: false,
      received_date: null,
      received_amount: null,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return rowToInstallment(data as InstallmentRow);
}

type InstallmentWithDealRow = InstallmentRow & {
  deal: { id: string; nome: string; seller_id: string } | null;
};

/**
 * Busca todas as parcelas com o nome do cliente e seller_id num único query (JOIN
 * via embedding do supabase). Resolve o nome do vendedor a partir do mapa de profiles
 * passado pelo chamador. Devolve também o total de parcelas do deal pra exibir
 * "Parcela X/Y" sem N+1.
 */
export async function fetchAllInstallmentsWithDeal(
  profileMap: Map<string, Profile>
): Promise<InstallmentWithDeal[]> {
  const { data, error } = await supabase
    .from('deal_installments')
    .select('*, deal:deals!inner(id, nome, seller_id)')
    .order('due_date', { ascending: true });
  if (error) throw error;

  const rows = (data || []) as InstallmentWithDealRow[];

  const totalsByDeal = new Map<string, number>();
  for (const r of rows) {
    totalsByDeal.set(r.deal_id, (totalsByDeal.get(r.deal_id) || 0) + 1);
  }

  return rows
    .filter(r => r.deal != null)
    .map(r => {
      const base = rowToInstallment(r);
      return {
        ...base,
        dealNome: r.deal!.nome,
        dealSellerId: r.deal!.seller_id,
        dealSellerName: profileMap.get(r.deal!.seller_id)?.name,
        dealInstallmentsTotal: totalsByDeal.get(r.deal_id) || 1,
      };
    });
}

/**
 * Busca parcelas com due_date dentro do range (inclusivo) já com o deal embutido.
 * Faz uma segunda query rasa pra somar o total de parcelas de cada deal envolvido,
 * preservando o "Parcela X/Y" mesmo quando outras parcelas do mesmo deal caem fora
 * do range. Sem N+1 — duas queries fixas.
 */
export async function fetchInstallmentsByDueDateRange(
  startISO: string,
  endISO: string,
  profileMap: Map<string, Profile>
): Promise<InstallmentWithDeal[]> {
  const { data, error } = await supabase
    .from('deal_installments')
    .select('*, deal:deals!inner(id, nome, seller_id)')
    .gte('due_date', startISO)
    .lte('due_date', endISO)
    .order('due_date', { ascending: true });
  if (error) throw error;

  const rows = (data || []) as InstallmentWithDealRow[];
  if (rows.length === 0) return [];

  const dealIds = Array.from(new Set(rows.map(r => r.deal_id)));
  const { data: countRows, error: countErr } = await supabase
    .from('deal_installments')
    .select('deal_id')
    .in('deal_id', dealIds);
  if (countErr) throw countErr;

  const totalsByDeal = new Map<string, number>();
  for (const r of (countRows || []) as { deal_id: string }[]) {
    totalsByDeal.set(r.deal_id, (totalsByDeal.get(r.deal_id) || 0) + 1);
  }

  return rows
    .filter(r => r.deal != null)
    .map(r => {
      const base = rowToInstallment(r);
      return {
        ...base,
        dealNome: r.deal!.nome,
        dealSellerId: r.deal!.seller_id,
        dealSellerName: profileMap.get(r.deal!.seller_id)?.name,
        dealInstallmentsTotal: totalsByDeal.get(r.deal_id) || 1,
      };
    });
}

/**
 * Soma e contagem das parcelas em aberto (is_received=false) com due_date até a
 * data informada (inclusivo). Acumulativo: inclui parcelas vencidas de meses
 * anteriores que ainda não foram recebidas.
 */
export async function fetchOpenInstallmentsUntil(
  endISO: string
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase
    .from('deal_installments')
    .select('amount')
    .eq('is_received', false)
    .lte('due_date', endISO);
  if (error) throw error;
  const rows = (data || []) as { amount: number | string }[];
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return { total, count: rows.length };
}

/**
 * Soma e contagem das parcelas recebidas com received_date dentro do range
 * (inclusivo). Usa received_amount (valor real) como base do total.
 */
export async function fetchReceivedInstallmentsInRange(
  startISO: string,
  endISO: string
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase
    .from('deal_installments')
    .select('amount, received_amount')
    .eq('is_received', true)
    .gte('received_date', startISO)
    .lte('received_date', endISO);
  if (error) throw error;
  const rows = (data || []) as { amount: number | string; received_amount: number | string | null }[];
  const total = rows.reduce(
    (s, r) => s + (r.received_amount != null ? Number(r.received_amount) : Number(r.amount) || 0),
    0
  );
  return { total, count: rows.length };
}
