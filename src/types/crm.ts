export type Stage = 'lead_novo' | 'qualificacao' | 'orcamento_enviado' | 'negociacao' | 'fechado' | 'perdido';

export type ServiceType = 'economico' | 'completo';

export type LossReason = 'preco' | 'concorrencia' | 'desistiu' | 'sem_resposta' | 'outro';

export interface Deal {
  id: string;
  nome: string;
  telefone: string;
  origem: string;
  destino: string;
  dataMudanca: string;
  tipoServico: ServiceType;
  valor: number;
  stage: Stage;
  parceiro: string;
  motivoPerda?: LossReason;
  createdAt: string;
  updatedAt: string;
}

export interface StageConfig {
  id: Stage;
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
}

export const STAGES: StageConfig[] = [
  { id: 'lead_novo', label: 'Lead Novo', color: 'bg-stage-lead', bgColor: 'bg-stage-lead/10', textColor: 'text-stage-lead' },
  { id: 'qualificacao', label: 'Qualificação', color: 'bg-stage-qualification', bgColor: 'bg-stage-qualification/10', textColor: 'text-stage-qualification' },
  { id: 'orcamento_enviado', label: 'Orçamento Enviado', color: 'bg-stage-quote', bgColor: 'bg-stage-quote/10', textColor: 'text-stage-quote' },
  { id: 'negociacao', label: 'Negociação', color: 'bg-stage-negotiation', bgColor: 'bg-stage-negotiation/10', textColor: 'text-stage-negotiation' },
  { id: 'fechado', label: 'Fechado', color: 'bg-stage-closed', bgColor: 'bg-stage-closed/10', textColor: 'text-stage-closed' },
  { id: 'perdido', label: 'Perdido', color: 'bg-stage-lost', bgColor: 'bg-stage-lost/10', textColor: 'text-stage-lost' },
];

export const LOSS_REASONS: Record<LossReason, string> = {
  preco: 'Preço alto',
  concorrencia: 'Concorrência',
  desistiu: 'Desistiu da mudança',
  sem_resposta: 'Sem resposta',
  outro: 'Outro',
};

export const SERVICE_TYPES: Record<ServiceType, string> = {
  economico: 'Econômico',
  completo: 'Completo',
};

export interface Filters {
  dateFrom?: string;
  dateTo?: string;
  stage?: Stage | '';
  valueMin?: number;
  valueMax?: number;
  search?: string;
}

export type SortField = 'valor' | 'createdAt' | 'dataMudanca';
export type SortDirection = 'asc' | 'desc';
