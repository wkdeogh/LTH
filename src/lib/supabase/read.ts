import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv, hasSupabaseEnv } from '@/lib/env';
import { readCachePolicy } from './readCachePolicy';

export function createSupabaseReadClient() {
  if (!hasSupabaseEnv()) return null;
  return createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        return fetch(input, { ...init, ...readCachePolicy(url, method) });
      },
    },
  });
}
