#!/usr/bin/env node
// Simula a Meta chamando o webhook do CRM, com assinatura válida.
// NÃO usa WhatsApp de verdade: é só para testar a "porta de entrada".
//
// Uso:
//   WHATSAPP_APP_SECRET=... node scripts/simulate-whatsapp-webhook.mjs <URL> [telefone] [texto]
//
// Exemplo (preview da Vercel):
//   WHATSAPP_APP_SECRET=... node scripts/simulate-whatsapp-webhook.mjs \
//     https://SEU-PREVIEW.vercel.app/api/whatsapp/webhook 5500000000001 "Teste simulado"
//
// O segredo é lido da variável de ambiente (nunca vai na linha de comando/histórico).
// Use SEMPRE um telefone fictício, para ser fácil identificar e apagar depois.

import { createHmac, randomUUID } from "node:crypto";

const [url, phone = "5500000000001", text = "Mensagem de TESTE (simulada)"] = process.argv.slice(2);
const secret = process.env.WHATSAPP_APP_SECRET;

if (!url || !secret) {
  console.error("Uso: WHATSAPP_APP_SECRET=... node scripts/simulate-whatsapp-webhook.mjs <URL> [telefone] [texto]");
  process.exit(1);
}

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "SIMULADO",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            contacts: [{ wa_id: phone, profile: { name: "TESTE Simulado" } }],
            messages: [
              {
                from: phone,
                id: `wamid.SIMULADO.${randomUUID()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});

const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  body,
});
console.log(res.status, await res.text());
