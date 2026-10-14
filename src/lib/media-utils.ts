/** Limite por envio (a Vercel aceita ~4,5 MB no corpo; arquivos maiores precisam de armazenamento próprio). */
export const MAX_UPLOAD_BYTES = 4_000_000;

/** Tipos que o WhatsApp aceita e o CRM envia (mesma lista do servidor). */
export const ACCEPTED_MIME = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/3gpp',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** Valor do atributo "accept" do seletor de arquivos. */
export const ACCEPT_ATTR = `image/*,${ACCEPTED_MIME.filter(t => !t.startsWith('image/')).join(',')}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Mensagem de erro em português se o arquivo não puder ser enviado; null se estiver ok. */
export function validateUpload(file: Pick<File, 'type' | 'size'>): string | null {
  const type = file.type.split(';')[0].toLowerCase();
  if (!ACCEPTED_MIME.includes(type)) {
    return 'Tipo de arquivo não aceito. Use foto (JPG/PNG), vídeo (MP4), áudio, PDF, Word, Excel, PowerPoint ou texto.';
  }
  if (file.size <= 0) return 'O arquivo está vazio.';
  if (file.size > MAX_UPLOAD_BYTES) return `Arquivo grande demais (${formatBytes(file.size)}). Por enquanto o limite é de 4 MB por envio.`;
  return null;
}

/** Fotos maiores que isto são reduzidas no navegador antes do envio. */
const COMPRESS_ABOVE_BYTES = 1_200_000;
const MAX_SIDE = 2000;

/**
 * Fotos de celular costumam passar de 4 MB: reduz para até 2000 px e JPEG antes de enviar.
 * Outros tipos de arquivo passam sem mudança. Se não der para ler a imagem, devolve a original.
 */
export async function prepareFileForUpload(file: File): Promise<File> {
  const isPhoto = file.type.startsWith('image/');
  if (!isPhoto || (file.size <= COMPRESS_ABOVE_BYTES && (file.type === 'image/jpeg' || file.type === 'image/png'))) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff'; // PNG com fundo transparente vira JPEG: preenche de branco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.65, 0.5]) {
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
      }
    }
    return file;
  } catch {
    return file;
  }
}
