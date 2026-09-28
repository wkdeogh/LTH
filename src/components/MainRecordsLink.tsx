import { GlobalNavLink } from '@/components/GlobalNavLink';
import { createSupabaseReadClient } from '@/lib/supabase/read';

export async function MainRecordsLink() {
  const supabase = await createSupabaseReadClient();
  const result = supabase ? await supabase.from('strategies').select('id').eq('is_main', true).eq('is_archived', false).maybeSingle() : null;
  return <GlobalNavLink href={result?.data ? `/strategies/${result.data.id}/rounds` : '/rounds'} section="records">기록</GlobalNavLink>;
}
