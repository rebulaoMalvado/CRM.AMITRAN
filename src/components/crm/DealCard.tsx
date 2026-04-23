import { Deal } from '@/types/crm';
import { formatCurrency, getStageConfig, isStuckDeal, isHotDeal, isNewDeal } from '@/lib/crm-utils';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Calendar, Clock, Flame, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DealCardProps {
  deal: Deal;
  onClick: (deal: Deal) => void;
}

const DealCard = ({ deal, onClick }: DealCardProps) => {
  const { isHead } = useAuth();
  const stuck = isStuckDeal(deal);
  const hot = isHotDeal(deal);
  const isNew = isNewDeal(deal);
  const stage = getStageConfig(deal.stage);

  return (
    <div
      className={`deal-card relative ${hot ? 'hot-deal' : ''}`}
      onClick={() => onClick(deal)}
    >
      {stuck && <div className="stuck-indicator" title="Lead parado há mais de 24h" />}

      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-semibold text-card-foreground truncate pr-4">{deal.nome}</h4>
        {isNew && (
          <span className="shrink-0 text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded">NOVO</span>
        )}
      </div>

      {isHead && deal.sellerName && (
        <div className="flex items-center gap-1 mb-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary truncate">
            <User className="w-2.5 h-2.5 shrink-0" />
            Vendedor: {deal.sellerName}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
        <MapPin className="w-3 h-3 shrink-0" />
        <span className="truncate">{deal.origem} → {deal.destino}</span>
      </div>

      {deal.dataMudanca && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
          <Calendar className="w-3 h-3 shrink-0" />
          <span>{format(new Date(deal.dataMudanca), "dd MMM yyyy", { locale: ptBR })}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-card-foreground flex items-center gap-1">
          {hot && <Flame className="w-3.5 h-3.5 text-warning" />}
          {formatCurrency(deal.valor)}
        </span>
        <span className={`stage-badge ${stage.bgColor} ${stage.textColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${stage.color}`} />
          {deal.tipoServico === 'completo' ? 'Completo' : 'Econômico'}
        </span>
      </div>

      {stuck && (
        <div className="flex items-center gap-1 mt-2 text-[10px] text-warning">
          <Clock className="w-3 h-3" />
          Parado há mais de 24h
        </div>
      )}
    </div>
  );
};

export default DealCard;
