import { useCallback, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useCRM } from '@/contexts/CRMContext';
import { STAGES, Deal } from '@/types/crm';
import { formatCurrency } from '@/lib/crm-utils';
import DealCard from './DealCard';
import DealModal from './DealModal';
import { PAGE_SIZE, visibleDeals } from '@/lib/pipeline-view';

const Pipeline = () => {
  const { getDealsByStage, moveDeal, addDeal, updateDeal, deleteDeal } = useCRM();
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showModal, setShowModal] = useState(false);
  // Quantos cards cada coluna desenha (colunas com centenas de cards travavam o arrastar).
  const [limits, setLimits] = useState<Record<string, number>>({});
  // Cards movidos nesta sessão: ficam visíveis mesmo se a coluna esconder os mais antigos.
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const dealId = result.draggableId;
    const newStage = result.destination.droppableId as Deal['stage'];
    if (result.destination.droppableId !== result.source.droppableId) {
      setPinned(prev => new Set(prev).add(dealId));
    }
    moveDeal(dealId, newStage);
  };

  const openDeal = useCallback((deal: Deal) => {
    setSelectedDeal(deal);
    setShowModal(true);
  }, []);

  const openNewDeal = () => {
    setSelectedDeal(null);
    setShowModal(true);
  };

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scroll-smooth snap-x snap-mandatory sm:snap-none">
          {STAGES.map((stage) => {
            const stageDeals = getDealsByStage(stage.id);
            const limit = limits[stage.id] ?? PAGE_SIZE;
            const shownDeals = visibleDeals(stageDeals, limit, pinned);
            const hiddenCount = stageDeals.length - shownDeals.length;
            const totalValue = stageDeals.reduce((sum, d) => sum + d.valor, 0);
            const progress = stageDeals.length > 0 ? Math.min(100, (stageDeals.length / 5) * 100) : 0;

            return (
              <Droppable key={stage.id} droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`pipeline-column min-w-[260px] w-[85vw] sm:min-w-[280px] sm:w-[280px] shrink-0 snap-start transition-colors ${snapshot.isDraggingOver ? 'bg-accent/50 border-primary/30' : ''}`}
                  >
                    {/* Header */}
                    <div className="p-4 border-b border-border/50">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                        <h3 className="text-sm font-semibold text-card-foreground">{stage.label}</h3>
                        <span className="ml-auto text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{stageDeals.length}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">{formatCurrency(totalValue)}</div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${stage.color} rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    {/* Cards */}
                    <div className="p-2 flex-1 space-y-2 overflow-y-auto scrollbar-thin max-h-[calc(100vh-340px)] min-h-[300px]">
                      {shownDeals.map((deal, index) => (
                        <Draggable key={deal.id} draggableId={deal.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={snapshot.isDragging ? 'opacity-90 rotate-1' : ''}
                            >
                              <DealCard deal={deal} onClick={openDeal} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {(hiddenCount > 0 || limit > PAGE_SIZE) && (
                        <div className="flex gap-2 pt-1">
                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setLimits(prev => ({ ...prev, [stage.id]: limit + PAGE_SIZE }))}
                              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
                            >
                              Mostrar mais ({hiddenCount})
                            </button>
                          )}
                          {limit > PAGE_SIZE && (
                            <button
                              type="button"
                              onClick={() => setLimits(prev => ({ ...prev, [stage.id]: PAGE_SIZE }))}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:text-card-foreground hover:bg-accent transition-colors"
                            >
                              Mostrar menos
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* Floating add button */}
      <button
        onClick={openNewDeal}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-2xl font-light z-40"
      >
        +
      </button>

      <DealModal
        deal={selectedDeal}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={addDeal}
        onUpdate={updateDeal}
        onDelete={deleteDeal}
      />
    </>
  );
};

export default Pipeline;
