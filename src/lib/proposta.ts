const TEMPLATE_URL = '/templates/proposta-amitran.html';
const NUMERO_PROPOSTA_DEFAULT = '6711.2026';

export interface PropostaForm {
  nomeCliente: string;
  telefoneCliente: string;
  volumeEstimado: string;
  dataMudanca: string;
  tipo: string;
  origem: string;
  destino: string;
  valorMudanca: number;
  valorSeguro: string;
  total: string;
  nomeVendedor: string;
  emailVendedor: string;
}

/** String padrão para o campo "Total" baseada no valor da mudança. */
export const defaultTotal = (valorMudanca: number): string =>
  `R$ ${(Number.isFinite(valorMudanca) ? valorMudanca : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} + 2% do valor do seguro`;

interface ManifestEntry {
  mime: string;
  compressed: boolean;
  data: string;
}

interface ExtResource {
  uuid: string;
  id: string;
}

let cachedFlatTemplate: Promise<string> | null = null;

const formatBRL = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatDateBR = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const todayBR = (): string => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const replaceAll = (haystack: string, needle: string, replacement: string): string =>
  haystack.split(needle).join(replacement);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
};

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error('DecompressionStream não suportado neste navegador');
  const ds = new DS('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Lê o template "bundler" e retorna um HTML auto-contido com todos os assets
 * convertidos em data: URLs. Os placeholders {{...}} e os 3 campos editáveis
 * (volume / tipo / valor seguro) permanecem intactos para serem substituídos
 * por applyFormToTemplate.
 */
async function loadFlatTemplate(): Promise<string> {
  if (cachedFlatTemplate) return cachedFlatTemplate;
  cachedFlatTemplate = (async () => {
    const res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error(`Falha ao carregar template (${res.status})`);
    const raw = await res.text();

    const manifestMatch = raw.match(/<script type="__bundler\/manifest">\s*([\s\S]+?)\s*<\/script>/);
    const templateMatch = raw.match(/<script type="__bundler\/template">\s*([\s\S]+?)\s*<\/script>/);
    const extMatch = raw.match(/<script type="__bundler\/ext_resources">\s*([\s\S]+?)\s*<\/script>/);
    if (!manifestMatch || !templateMatch) {
      throw new Error('Template inválido: scripts do bundler ausentes');
    }

    const manifest = JSON.parse(manifestMatch[1]) as Record<string, ManifestEntry>;
    let template = JSON.parse(templateMatch[1]) as string;
    const extResources = (extMatch ? JSON.parse(extMatch[1]) : []) as ExtResource[];

    const dataUrls: Record<string, string> = {};
    await Promise.all(
      Object.entries(manifest).map(async ([uuid, entry]) => {
        const binStr = atob(entry.data);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const finalBytes = entry.compressed ? await gunzip(bytes) : bytes;
        dataUrls[uuid] = `data:${entry.mime};base64,${bytesToBase64(finalBytes)}`;
      })
    );

    for (const uuid of Object.keys(manifest)) {
      template = replaceAll(template, uuid, dataUrls[uuid]);
    }

    template = template.replace(/\s+integrity="[^"]*"/gi, '').replace(/\s+crossorigin="[^"]*"/gi, '');

    const resourceMap: Record<string, string> = {};
    for (const e of extResources) {
      if (dataUrls[e.uuid]) resourceMap[e.id] = dataUrls[e.uuid];
    }
    const resourceScript =
      '<script>window.__resources = ' +
      JSON.stringify(resourceMap).replace(/<\/script>/gi, '<\\/script>') +
      ';</script>';
    const headOpen = template.match(/<head[^>]*>/i);
    if (headOpen && headOpen.index !== undefined) {
      const i = headOpen.index + headOpen[0].length;
      template = template.slice(0, i) + resourceScript + template.slice(i);
    }

    return template;
  })();
  return cachedFlatTemplate;
}

/**
 * Aplica os valores do formulário ao template já achatado.
 */
export function applyFormToTemplate(template: string, form: PropostaForm): string {
  let html = template;

  // Total: substitui a linha inteira ANTES dos placeholders. O conteúdo do
  // span fica livre — usuário pode editar pra qualquer string. Se vazio, usa
  // o padrão calculado a partir do valor da mudança.
  const totalStr = (form.total || '').trim() || defaultTotal(form.valorMudanca);
  html = html.replace(
    '<div class="val">R$ <span class="ph">{{VALOR_MUDANCA}} + 2% do valor do seguro</span></div>',
    `<div class="val"><span class="ph">${escapeHtml(totalStr)}</span></div>`
  );

  const map: Record<string, string> = {
    '{{NUMERO_PROPOSTA}}': NUMERO_PROPOSTA_DEFAULT,
    '{{NOME_CLIENTE}}': escapeHtml(form.nomeCliente || ''),
    '{{TELEFONE_CLIENTE}}': escapeHtml(form.telefoneCliente || ''),
    '{{DATA_MUDANCA}}': escapeHtml(formatDateBR(form.dataMudanca)),
    '{{DATA_EMISSAO}}': todayBR(),
    '{{ENDERECO_ORIGEM}}': escapeHtml(form.origem || ''),
    '{{ENDERECO_DESTINO}}': escapeHtml(form.destino || ''),
    '{{VALOR_MUDANCA}}': formatBRL(form.valorMudanca),
    '{{NOME_VENDEDOR}}': escapeHtml(form.nomeVendedor || ''),
    '{{EMAIL_VENDEDOR}}': escapeHtml(form.emailVendedor || ''),
  };

  for (const [k, v] of Object.entries(map)) html = replaceAll(html, k, v);

  const volumeRaw = (form.volumeEstimado || '').trim();
  const volumeStr = volumeRaw ? `${escapeHtml(volumeRaw)} m³` : '— m³';
  html = html.replace(
    '<div class="f-val">— m³</div>',
    `<div class="f-val">${volumeStr}</div>`
  );

  const tipoStr = escapeHtml((form.tipo || '').trim() || 'Residencial');
  html = html.replace(
    '<div class="f-lbl">Tipo</div><div class="f-val">Residencial</div>',
    `<div class="f-lbl">Tipo</div><div class="f-val">${tipoStr}</div>`
  );

  const seguroStr = escapeHtml((form.valorSeguro || '').trim() || 'A DECLARAR');
  html = html.replace(
    '<div class="val" style="">A DECLARAR</div>',
    `<div class="val" style="">${seguroStr}</div>`
  );

  return html;
}

/**
 * Carrega + aplica o form. Usado pelo preview e pela geração de PDF.
 */
export async function buildPropostaHtml(form: PropostaForm): Promise<string> {
  const template = await loadFlatTemplate();
  return applyFormToTemplate(template, form);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForFonts(doc: Document): Promise<void> {
  type FontFaceSet = { ready?: Promise<unknown> };
  const fonts = (doc as unknown as { fonts?: FontFaceSet }).fonts;
  if (fonts && fonts.ready) {
    try { await fonts.ready; } catch { /* ignore */ }
  }
}

async function waitForImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(
    imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>(resolve => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    })
  );
}

// CSS injetado APENAS no contexto de impressão. Faz duas coisas:
// 1. Força Chrome a imprimir backgrounds/cores (capa azul, fotos dos
//    serviços que são background-image). Por padrão Chrome descarta
//    backgrounds no print — `print-color-adjust: exact` ignora isso.
// 2. Neutraliza o destaque amarelo dos placeholders (.ph) — visual só do
//    preview, no PDF deve sair como texto normal.
const PRINT_OVERRIDE_CSS = `
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  html, body {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .ph {
    display: inline !important;
    background: transparent !important;
    color: inherit !important;
    border: none !important;
    border-bottom: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
    font-family: inherit !important;
    font-size: inherit !important;
    font-weight: inherit !important;
    letter-spacing: inherit !important;
  }
`;

/**
 * Abre o diálogo nativo de impressão do navegador com a proposta renderizada.
 * O Chrome usa o motor Skia/PDF (mesmo que o designer usou) — produz PDF
 * vetorial com fontes corretas, sem perda de espaços nem placeholders amarelos.
 *
 * Trade-off: o usuário precisa escolher "Salvar como PDF" no diálogo. O
 * `documentTitle` é usado pelo Chrome como sugestão de filename.
 */
export async function imprimirProposta(form: PropostaForm, documentTitle: string): Promise<void> {
  const html = await buildPropostaHtml(form);

  // Injeta o override CSS dentro do <head> antes de renderizar
  const printableHtml = html.replace(
    /<head([^>]*)>/i,
    (_, attrs) => `<head${attrs}><style id="__print_override">${PRINT_OVERRIDE_CSS}</style>`
  );

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      iframe.addEventListener('error', () => reject(new Error('Falha ao carregar proposta')), { once: true });
      iframe.srcdoc = printableHtml;
    });

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error('Não foi possível acessar o iframe');

    // Title é usado pelo Chrome como sugestão de filename ao "Salvar como PDF"
    doc.title = documentTitle;

    await waitForFonts(doc);
    await waitForImages(doc);
    await sleep(200);

    win.focus();
    win.print();

    // Em alguns navegadores o print é bloqueante; em outros não. Aguardamos um
    // tempo razoável antes de remover o iframe pra dar tempo do diálogo abrir.
    await sleep(500);
  } finally {
    // Não removemos imediatamente — alguns navegadores fecham o diálogo se o
    // iframe sumir. Tira após 2min (ou no próximo print).
    setTimeout(() => iframe.remove(), 120_000);
  }
}

/**
 * Limpa o cache do template (útil em testes).
 */
export function _resetPropostaCache(): void {
  cachedFlatTemplate = null;
}
