import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltam variáveis de ambiente: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. ' +
    'Crie um .env.local baseado em .env.example.'
  );
}

export const supabase = createClient(url, anonKey);

export function createAdminSignupClient() {
  return createClient(url, anonKey, {
    auth: {
      storageKey: 'sb-admin-signup',
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
