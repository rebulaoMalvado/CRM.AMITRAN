import chromium from "@sparticuz/chromium";
import puppeteer, { type LaunchOptions } from "puppeteer-core";
import { buildPrintableHtml, type PropostaForm } from "../src/lib/proposta.js";

export interface PropostaRender {
  pdf: Uint8Array;
  /** Foto (JPEG) da primeira página, ou null se não deu para tirar (o PDF não depende dela). */
  cover: Uint8Array | null;
}

export interface RenderOptions {
  /** true = além do PDF, tira a foto da capa (primeira página). */
  withCover?: boolean;
  /** Só para testes locais (ex.: usar o Chrome do computador em vez do Chromium da Vercel). */
  launchOptions?: LaunchOptions;
}

/**
 * Gera o PDF da proposta no servidor, com um navegador Chromium "invisível": é o MESMO motor
 * que o Chrome usa em "Salvar como PDF", então o resultado é igual ao que sai da impressão.
 * O modelo (HTML) é buscado do próprio site (templateUrl) e preenchido com os dados do formulário.
 * Com `withCover`, aproveita o mesmo navegador para fotografar a primeira página (capa).
 */
export async function renderProposta(form: PropostaForm, templateUrl: string, options: RenderOptions = {}): Promise<PropostaRender> {
  const html = await buildPrintableHtml(form, templateUrl);

  let browser;
  if (options.launchOptions) {
    browser = await puppeteer.launch({ defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 }, ...options.launchOptions });
  } else {
    (chromium as unknown as { setGraphicsMode: boolean }).setGraphicsMode = false;
    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  try {
    const page = await browser.newPage();
    // Tudo (fotos e fontes do modelo) já vai embutido no HTML: basta esperar o "load".
    await page.setContent(html, { waitUntil: "load", timeout: 45_000 });
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready);

    // Falha ao fotografar a capa nunca derruba o PDF: segue sem a foto.
    let cover: Uint8Array | null = null;
    if (options.withCover) {
      try {
        const box = await (await page.$("section.page"))?.boundingBox();
        if (box) {
          // scale 1,5: a página A4 (794x1123) vira ~1190x1685 px, nítida no celular e ainda leve (JPEG).
          const shot = await page.screenshot({ type: "jpeg", quality: 82, clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1.5 } });
          cover = new Uint8Array(shot);
        }
      } catch (err) {
        console.error("[proposta] não consegui fotografar a capa:", err instanceof Error ? err.message : err);
      }
    }

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return { pdf, cover };
  } finally {
    await browser.close();
  }
}

/** Só o PDF (usado no "Baixar PDF"). */
export async function renderPropostaPdf(form: PropostaForm, templateUrl: string): Promise<Uint8Array> {
  return (await renderProposta(form, templateUrl)).pdf;
}
