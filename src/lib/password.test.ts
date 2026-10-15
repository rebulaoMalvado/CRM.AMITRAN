import { describe, expect, it } from 'vitest';
import { friendlyAuthError, validateNewPassword } from './password';

describe('validateNewPassword', () => {
  it('aceita senha com 8+ caracteres iguais nos dois campos', () => {
    expect(validateNewPassword('Gabriel#2026', 'Gabriel#2026')).toBeNull();
  });
  it('recusa senha curta', () => {
    expect(validateNewPassword('abc123', 'abc123')).toMatch(/pelo menos 8/);
  });
  it('recusa quando as duas não são iguais', () => {
    expect(validateNewPassword('Gabriel#2026', 'Gabriel#2027')).toMatch(/não são iguais/);
  });
});

describe('friendlyAuthError', () => {
  it('traduz erros conhecidos', () => {
    expect(friendlyAuthError('New password should be different from the old password.')).toMatch(/diferente/);
    expect(friendlyAuthError('Email rate limit exceeded')).toMatch(/Muitas tentativas/);
    expect(friendlyAuthError('Email link is invalid or has expired')).toMatch(/vencido/);
  });
  it('mantém a mensagem original quando não conhece', () => {
    expect(friendlyAuthError('algo estranho')).toBe('algo estranho');
  });
});
