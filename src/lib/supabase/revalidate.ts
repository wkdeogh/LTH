import 'server-only';
import { revalidatePath, revalidateTag } from 'next/cache';
import { READ_CACHE_TAG, MARKET_CACHE_TAG } from './readCachePolicy';

export function invalidateReadData() {
  revalidateTag(READ_CACHE_TAG, { expire: 0 });
}

export function revalidateAppPath(path: string, type?: 'page' | 'layout') {
  invalidateReadData();
  revalidatePath(path, type);
}

export function revalidateMarketData() {
  revalidateTag(MARKET_CACHE_TAG, { expire: 0 });
}
