/**
 * Tiers come from the server (admin Settings > Tiers), so one Afrizone adds
 * shows up here without an app update. The five built-ins are the fallback
 * until the list loads, or if it cannot.
 */
import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { TIERS as BUILT_IN } from './kyc';

export interface TierInfo {
  key: string;
  label: string;
  description: string | null;
  docLabel: string | null;
}

const FALLBACK: TierInfo[] = BUILT_IN.map((t) => ({
  key: t.key,
  label: t.key.charAt(0) + t.key.slice(1).toLowerCase(),
  description: t.blurb,
  docLabel: t.docLabel,
}));

let cache: TierInfo[] | null = null;
let loading: Promise<TierInfo[]> | null = null;

export function loadTiers(): Promise<TierInfo[]> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = request<TierInfo[]>('/reference/tiers')
      .then((rows) => {
        cache = rows.length ? rows : FALLBACK;
        return cache;
      })
      .catch(() => {
        loading = null;
        return FALLBACK;
      });
  }
  return loading;
}

/** A tier's name, from the loaded list when there is one. */
export function tierName(key: string): string {
  return (cache ?? FALLBACK).find((t) => t.key === key)?.label ?? key.charAt(0) + key.slice(1).toLowerCase();
}

export function useTiers(): TierInfo[] {
  const [tiers, setTiers] = useState<TierInfo[]>(cache ?? FALLBACK);
  useEffect(() => {
    let live = true;
    loadTiers().then((t) => live && setTiers(t));
    return () => {
      live = false;
    };
  }, []);
  return tiers;
}
