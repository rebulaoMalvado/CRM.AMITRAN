import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashButton } from './TrashModal';

// Funções FIXAS (como o useCallback do CRM real): se mudassem a cada desenho, a janela refaria a busca sem parar.
const crm = {
  fetchDeletedDeals: async () => [],
  restoreDeal: async () => {},
  purgeDeal: async () => {},
};
vi.mock('@/contexts/CRMContext', () => ({ useCRM: () => crm }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Lixeira', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const abrir = async () => {
    await act(async () => {
      root.render(
        <header className="backdrop-blur-xl">
          <TrashButton />
        </header>,
      );
    });
    await act(async () => {
      (container.querySelector('button[title="Lixeira — deals excluídos"]') as HTMLButtonElement).click();
    });
  };

  it('a janela abre FORA do cabeçalho (o "backdrop-blur" do cabeçalho prenderia a janela no topo)', async () => {
    await abrir();
    const titulo = document.querySelector('h2');
    expect(titulo?.textContent).toBe('Lixeira');
    expect(titulo?.closest('header')).toBeNull();
    expect(titulo?.closest('.modal-overlay')?.parentElement).toBe(document.body);
  });

  it('o botão X fecha a janela', async () => {
    await abrir();
    await act(async () => {
      (document.querySelector('.modal-overlay button') as HTMLButtonElement).click(); // 1º botão da janela = X
    });
    expect(document.querySelector('h2')).toBeNull();
  });
});
