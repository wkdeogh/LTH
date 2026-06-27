import { createClient } from '@supabase/supabase-js';
import { getRequiredEnv, hasSupabaseEnv } from '@/lib/env';

export function createSupabaseServerClient() {
  if (!hasSupabaseEnv()) return null;

  return createClient(getRequiredEnv('SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
