import { handleSinkDelivery, handleSinkVerification } from "../../server/sink-handler.js";

// Endereço "ralo" do Dualhook: descarta as cópias assinadas com a chave deles (o mesmo conteúdo
// chega validado pelo nosso app em /api/whatsapp/webhook). O caminho é longo de propósito.

const env = () => ({ verifyToken: process.env.WHATSAPP_VERIFY_TOKEN });

export async function GET(request: Request): Promise<Response> {
  return handleSinkVerification(request, env());
}

export async function POST(request: Request): Promise<Response> {
  return handleSinkDelivery(request);
}
