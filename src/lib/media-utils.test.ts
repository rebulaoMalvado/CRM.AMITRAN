import { describe, expect, it } from 'vitest';
import { formatBytes, MAX_UPLOAD_BYTES, validateUpload } from './media-utils';

describe('validateUpload', () => {
  it('aceita foto, vídeo, áudio, PDF e documentos de escritório', () => {
    for (const type of ['image/jpeg', 'image/png', 'video/mp4', 'audio/ogg', 'application/pdf', 'application/vnd.ms-excel']) {
      expect(validateUpload({ type, size: 1000 })).toBeNull();
    }
  });
  it('recusa tipos estranhos, vazio e acima do limite, com mensagem em português', () => {
    expect(validateUpload({ type: 'text/html', size: 1000 })).toContain('Tipo de arquivo não aceito');
    expect(validateUpload({ type: 'application/zip', size: 1000 })).toContain('Tipo de arquivo não aceito');
    expect(validateUpload({ type: 'image/webp', size: 1000 })).toContain('Tipo de arquivo não aceito');
    expect(validateUpload({ type: 'image/jpeg', size: 0 })).toBe('O arquivo está vazio.');
    expect(validateUpload({ type: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 })).toContain('limite é de 4 MB');
    expect(validateUpload({ type: 'application/pdf', size: MAX_UPLOAD_BYTES })).toBeNull();
  });
});

describe('formatBytes', () => {
  it('mostra tamanhos legíveis', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
