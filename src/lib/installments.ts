import { supabase } from '@/lib/supabase';
import { DealInstallment, DealInstallmentDraft } from '@/types/crm';

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
