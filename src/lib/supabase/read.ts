import 'server-only';
import { requireAppAccess } from '@/lib/access/server';
import { createSupabaseServerClient } from './server';

export async function createSupabaseReadClient() {
  await requireAppAccess();
  return createSupabaseServerClient();
}
