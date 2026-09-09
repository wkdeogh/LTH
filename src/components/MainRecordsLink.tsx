import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function MainRecordsLink() {
  const supabase = createSupabaseServerClient();
  const result = supabase ? await supabase.from('strategies').select('id').eq('is_main', true).eq('is_archived', false).maybeSingle() : null;
  return <Link href={result?.data ? `/strategies/${result.data.id}/rounds` : '/rounds'}>기록</Link>;
}
