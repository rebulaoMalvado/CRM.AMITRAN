#!/usr/bin/env node
// Assina o NOSSO app da Meta numa conta do WhatsApp (WABA), para a Meta mandar as mensagens
// também assinadas com a chave do nosso app. É a etapa que costuma faltar quando uma conta
// nova é criada por um parceiro (Dualhook etc.).
//
// Uso (no Terminal):
//   node scripts/meta-subscribe-app.mjs <WABA_ID>
//
// O token (de "usuário do sistema" com acesso a essa conta) é pedido ESCONDIDO e usado só
// aqui, em memória: não é gravado em arquivo nem aparece na tela.

const [wabaId] = process.argv.slice(2);
const VERSION = "v25.0";

if (!wabaId || !/^\d{8,20}$/.test(wabaId)) {
  console.error("Uso: node scripts/meta-subscribe-app.mjs <WABA_ID>");
  process.exit(1);
}

/** Lê uma linha sem mostrar o que é digitado/colado (modo "raw": aceita colar). */
function askHidden(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = "";
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value.trim());
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\u007f") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const token = await askHidden("Cole o token e aperte Enter (não aparece na tela): ");
if (!token) {
  console.error("Nenhum token informado.");
  process.exit(1);
}

const base = `https://graph.facebook.com/${VERSION}/${wabaId}`;
const headers = { authorization: `Bearer ${token}` };

async function call(method, path = "") {
  const res = await fetch(`${base}${path}`, { method, headers });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function show(list) {
  const apps = list.json?.data ?? [];
  if (apps.length === 0) return console.log("  (nenhum app assinado)");
  for (const a of apps) {
    const d = a.whatsapp_business_api_data ?? {};
    console.log(`  - ${d.name ?? "?"} (id ${d.id ?? "?"})`);
  }
}

const info = await call("GET", "?fields=id,name");
if (!info.ok) {
  console.error(`Não consegui ler a conta ${wabaId}: HTTP ${info.status} ${info.json?.error?.message ?? ""}`);
  console.error("Confira o ID da conta e se o usuário do sistema tem acesso a ela (controle total).");
  process.exit(1);
}
console.log(`Conta: ${info.json.name ?? "(sem nome)"} — ${info.json.id}`);

console.log("Apps assinados ANTES:");
show(await call("GET", "/subscribed_apps"));

const sub = await call("POST", "/subscribed_apps");
console.log(sub.ok ? "Assinatura do nosso app: OK" : `Falha ao assinar: HTTP ${sub.status} ${sub.json?.error?.message ?? ""}`);

console.log("Apps assinados DEPOIS:");
show(await call("GET", "/subscribed_apps"));
