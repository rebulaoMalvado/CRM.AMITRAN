import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, ImageOff, Loader2, Music, Play } from 'lucide-react';
import { fetchMessageMedia } from '@/lib/whatsapp-api';

interface Props {
  messageId: string;
  type: string;
  fileName?: string;
}

const AUTO_LOAD = ['image', 'sticker'];

/**
 * Mostra a foto, o vídeo, o áudio ou o documento de uma mensagem.
 * - Fotos e figurinhas carregam sozinhas, só quando aparecem na tela.
 * - Vídeo, áudio e documento carregam ao clicar (economiza internet).
 * O arquivo é buscado pelo nosso servidor, que confere se o usuário pode ver a conversa.
 */
const MediaBubble = ({ messageId, type, fileName }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!AUTO_LOAD.includes(type) || !ref.current) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [type]);

  const enabled = AUTO_LOAD.includes(type) ? visible : requested;
  const media = useQuery({
    queryKey: ['wa-media', messageId],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    queryFn: () => fetchMessageMedia(messageId),
  });

  const label = type === 'video' ? 'vídeo' : type === 'audio' ? 'áudio' : type === 'document' ? 'documento' : 'imagem';

  return (
    <div ref={ref} className="mb-1">
      {media.isLoading && (
        <div className="flex items-center gap-2 text-xs opacity-80 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando {label}...
        </div>
      )}

      {media.isError && (
        <div className="flex items-center gap-2 text-xs opacity-90 py-1">
          <ImageOff className="w-4 h-4 shrink-0" />
          <span>{(media.error as Error).message}</span>
          {!AUTO_LOAD.includes(type) && (
            <button type="button" onClick={() => media.refetch()} className="underline underline-offset-2">
              tentar de novo
            </button>
          )}
        </div>
      )}

      {!enabled && !AUTO_LOAD.includes(type) && (
        <button
          type="button"
          onClick={() => setRequested(true)}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-background/20 hover:bg-background/30 transition-colors"
        >
          {type === 'video' ? <Play className="w-4 h-4" /> : type === 'audio' ? <Music className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
          {type === 'video' ? 'Carregar vídeo' : type === 'audio' ? 'Carregar áudio' : `Baixar ${fileName ?? 'documento'}`}
        </button>
      )}

      {media.data && (
        <>
          {media.data.mime.startsWith('image/') && (
            <a href={media.data.url} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
              <img src={media.data.url} alt="Imagem da conversa" className="max-h-72 max-w-full rounded-lg object-contain" />
            </a>
          )}
          {media.data.mime.startsWith('video/') && (
            <video src={media.data.url} controls preload="metadata" className="max-h-72 max-w-full rounded-lg" />
          )}
          {media.data.mime.startsWith('audio/') && <audio src={media.data.url} controls className="max-w-full" />}
          {!/^(image|video|audio)\//.test(media.data.mime) && (
            <a
              href={media.data.url}
              download={fileName ?? 'arquivo'}
              className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-background/20 hover:bg-background/30"
            >
              <Download className="w-4 h-4" /> Salvar {fileName ?? 'arquivo'}
            </a>
          )}
        </>
      )}
    </div>
  );
};

export default MediaBubble;
