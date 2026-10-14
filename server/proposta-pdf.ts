import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { buildPrintableHtml, type PropostaForm } from "../src/lib/proposta.js";

/**
 * Gera o PDF da proposta no servidor, com um navegador Chromium "invisível": é o MESMO motor
 * que o Chrome usa em "Salvar como PDF", então o resultado é igual ao que sai da impressão.
 * O modelo (HTML) é buscado do próprio site (templateUrl) e preenchido com os dados do formulário.
 */
export async function renderPropostaPdf(form: PropostaForm, templateUrl: string): Promise<Uint8Array> {
  const html = await buildPrintableHtml(form, templateUrl);

  (chromium as unknown as { setGraphicsMode: boolean }).setGraphicsMode = false;
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 1 },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });

  try {
    const page = await browser.newPage();
    // Tudo (fotos e fontes do modelo) já vai embutido no HTML: basta esperar o "load".
    await page.setContent(html, { waitUntil: "load", timeout: 45_000 });
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close();
  }
}
