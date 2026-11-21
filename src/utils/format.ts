export function formatARS(value: number): string {
  const rounded = Math.round(value);
  return `$ ${rounded.toLocaleString('es-AR')}`;
}

export function formatARSTight(value: number): string {
  const rounded = Math.round(value);
  return `$${rounded.toLocaleString('es-AR')}`;
}

export function formatPctDecimal(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

export function formatTimeHHMM(date = new Date()): string {
  return date.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatSyncDateLabel(dateKey?: string, timeHHMM?: string): string {
  if (!dateKey) return timeHHMM ? `Hoy, ${timeHHMM}` : 'Sin sincronizar';
  const today = getLocalDateKey();
  if (dateKey === today) {
    return timeHHMM ? `Hoy, ${timeHHMM}` : 'Hoy';
  }
  const [, month, day] = dateKey.split('-');
  const shortDate = day && month ? `${day}/${month}` : dateKey;
  return timeHHMM ? `${shortDate}, ${timeHHMM}` : shortDate;
}

export const FALLBACK_PRODUCT_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' fill='%23F0EFEA'/%3E%3Crect x='46' y='44' width='68' height='72' rx='10' fill='none' stroke='%239A9CA4' stroke-width='5'/%3E%3Cpath d='M62 70h36M62 86h24' stroke='%239A9CA4' stroke-width='5' stroke-linecap='round'/%3E%3C/svg%3E";

export function calcDiscountPct(listPrice: number, price: number): number {
  if (!listPrice || listPrice <= price || price <= 0) return 0;
  return Math.round(((listPrice - price) / listPrice) * 100);
}

export function calcBranchVariant(
  product: { price: number; listPrice: number; discountPct: number },
  branchId: string
): { price: number; listPrice: number; discountPct: number; savings: number; note: string } {
  const baseList = product.listPrice || product.price;
  if (branchId === 'lomas') {
    const savings = Math.max(0, Math.round(baseList - product.price));
    return {
      price: product.price,
      listPrice: baseList,
      discountPct: product.discountPct,
      savings,
      note: 'Sucursal activa',
    };
  }
  if (branchId === 'ramos') {
    if (product.discountPct >= 20) {
      const altPct = Math.max(15, product.discountPct - 5);
      const altPrice = Math.round((baseList * (100 - altPct)) / 100 / 10) * 10;
      return {
        price: altPrice,
        listPrice: baseList,
        discountPct: altPct,
        savings: Math.max(0, Math.round(baseList - altPrice)),
        note: 'Descuento vigente en esta sucursal',
      };
    }
    return {
      price: product.price,
      listPrice: baseList,
      discountPct: product.discountPct,
      savings: Math.max(0, Math.round(baseList - product.price)),
      note: 'Mismo precio de lista',
    };
  }
  if (branchId === 'banfield') {
    if (product.discountPct === 0) {
      const altPct = 15;
      const altPrice = Math.round((baseList * (100 - altPct)) / 100 / 10) * 10;
      return {
        price: altPrice,
        listPrice: baseList,
        discountPct: altPct,
        savings: Math.max(0, Math.round(baseList - altPrice)),
        note: 'Cupón exclusivo en Banfield',
      };
    }
    return {
      price: product.price,
      listPrice: baseList,
      discountPct: product.discountPct,
      savings: Math.max(0, Math.round(baseList - product.price)),
      note: 'Mismo descuento Club Dia',
    };
  }
  return {
    price: product.price,
    listPrice: baseList,
    discountPct: product.discountPct,
    savings: Math.max(0, Math.round(baseList - product.price)),
    note: 'Precio de referencia Dia Online',
  };
}
