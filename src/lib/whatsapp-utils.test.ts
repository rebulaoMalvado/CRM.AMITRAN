import { describe, expect, it } from 'vitest';
import { conversationTitle, formatPhone, friendlyError, isWindowOpen, messageText, windowTimeLeft } from './whatsapp-utils';

const NOW = Date.parse('2026-10-01T15:00:00.000Z');
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('janela de 24h', () => {
  it('abre dentro de 24h e fecha depois, ou sem mensagem do cliente', () => {
    expect(isWindowOpen(ago(1), NOW)).toBe(true);
    expect(isWindowOpen(ago(23.9), NOW)).toBe(true);
    expect(isWindowOpen(ago(24.1), NOW)).toBe(false);
    expect(isWindowOpen(null, NOW)).toBe(false);
    expect(isWindowOpen('lixo', NOW)).toBe(false);
  });
  it('mostra o tempo que falta', () => {
    expect(windowTimeLeft(ago(20), NOW)).toBe('4h 0min');
    expect(windowTimeLeft(ago(23.5), NOW)).toBe('30min');
    expect(windowTimeLeft(ago(25), NOW)).toBeNull();
  });
});

describe('formatPhone / título', () => {
  it('formata celular e fixo brasileiros e outros países', () => {
    expect(formatPhone('5531988880001')).toBe('+55 (31) 98888-0001');
    expect(formatPhone('553133334444')).toBe('+55 (31) 3333-4444');
    expect(formatPhone('16315551181')).toBe('+16315551181');
  });
  it('usa o nome do WhatsApp ou cai para o telefone', () => {
    expect(conversationTitle({ contact_name: 'Maria', telefone_norm: '5531988880001', wa_id: '553188880001' })).toBe('Maria');
    expect(conversationTitle({ contact_name: '  ', telefone_norm: '5531988880001', wa_id: '553188880001' })).toBe('+55 (31) 98888-0001');
    expect(conversationTitle({ contact_name: null, telefone_norm: '', wa_id: '16315551181' })).toBe('+16315551181');
  });
});

describe('messageText', () => {
  it('mostra o texto ou um rótulo para mídia', () => {
    expect(messageText({ type: 'text', content: 'Oi' })).toBe('Oi');
    expect(messageText({ type: 'audio', content: null })).toBe('🎤 Áudio');
    expect(messageText({ type: 'novo_tipo', content: null })).toBe('Mensagem');
  });
});

describe('friendlyError', () => {
  it('traduz códigos conhecidos da Meta e ignora o resto', () => {
    expect(friendlyError('130497 · Business account is restricted from messaging users in this country.')).toContain('Brasil');
    expect(friendlyError('Meta recusou o envio (HTTP 400): 131030 · lista de permissão')).toContain('lista de permitidos');
    expect(friendlyError('Meta recusou o envio (HTTP 401): 190 · token')).toContain('expirou');
    expect(friendlyError('999999 · desconhecido')).toBeNull();
    expect(friendlyError(null)).toBeNull();
  });
});
