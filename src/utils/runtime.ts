import { CatalogSnapshot } from '../types/models';

interface StandaloneWindow extends Window {
  __CLUB_DIA_ASSETS__?: Record<string, string>;
  __CLUB_DIA_CATALOG__?: CatalogSnapshot;
  __CLUB_DIA_STANDALONE__?: boolean;
}

function getStandaloneWindow(): StandaloneWindow | undefined {
  return typeof window !== 'undefined' ? (window as StandaloneWindow) : undefined;
}

export function isFileProtocol(): boolean {
  const win = getStandaloneWindow();
  return Boolean(win && win.location.protocol === 'file:');
}

export function isStandaloneHtml(): boolean {
  const win = getStandaloneWindow();
  return Boolean(win?.__CLUB_DIA_STANDALONE__ || isFileProtocol());
}

export function resolveAssetUrl(path: string): string {
  const win = getStandaloneWindow();
  return win?.__CLUB_DIA_ASSETS__?.[path] ?? path;
}

export function getEmbeddedCatalog(): CatalogSnapshot | null {
  const win = getStandaloneWindow();
  const data = win?.__CLUB_DIA_CATALOG__;
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    return null;
  }
  return data;
}
