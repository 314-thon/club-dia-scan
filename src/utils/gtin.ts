export type GtinValidationResult =
  | {
      status: 'valid';
      /** EAN normalizado (13 dígitos para UPC-A/EAN-13, 8 para EAN-8, 14 para GTIN-14) */
      canonicalEan: string;
      /** Variantes equivalentes para buscar en IndexedDB o API (ej. con y sin 0 inicial en UPC-A) */
      lookupCandidates: string[];
      rawDigits: string;
    }
  | {
      status: 'weighable';
      canonicalEan: string;
      rawDigits: string;
    }
  | {
      status: 'invalid';
      rawDigits: string;
      reason: 'empty' | 'length' | 'checksum';
    };

/**
 * Calcula y valida el dígito verificador GS1 módulo 10 para GTIN-8, GTIN-12, GTIN-13 y GTIN-14.
 */
export function hasValidGs1Checksum(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  const len = digits.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) return false;

  let sum = 0;
  let weight = 3;
  for (let i = len - 2; i >= 0; i--) {
    sum += (digits.charCodeAt(i) - 48) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  const actual = digits.charCodeAt(len - 1) - 48;
  return expected === actual;
}

/**
 * Expande un código UPC-E (6 u 8 dígitos) a UPC-A (12 dígitos) según especificación GS1.
 */
export function expandUpcEToUpcA(digits: string): string | null {
  let numberSystem = '0';
  let body = '';
  let check = '';

  if (digits.length === 8 && (digits[0] === '0' || digits[0] === '1')) {
    numberSystem = digits[0];
    body = digits.slice(1, 7);
    check = digits[7];
  } else if (digits.length === 6) {
    body = digits;
  } else {
    return null;
  }

  const d1 = body[0];
  const d2 = body[1];
  const d3 = body[2];
  const d4 = body[3];
  const d5 = body[4];
  const d6 = body[5];

  let upcA11 = '';
  if (d6 === '0' || d6 === '1' || d6 === '2') {
    upcA11 = `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  } else if (d6 === '3') {
    upcA11 = `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`;
  } else if (d6 === '4') {
    upcA11 = `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`;
  } else {
    upcA11 = `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }

  if (check) {
    const candidate = `${upcA11}${check}`;
    return hasValidGs1Checksum(candidate) ? candidate : null;
  }

  let sum = 0;
  let weight = 3;
  for (let i = upcA11.length - 1; i >= 0; i--) {
    sum += (upcA11.charCodeAt(i) - 48) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const computedCheck = (10 - (sum % 10)) % 10;
  return `${upcA11}${computedCheck}`;
}

/**
 * Valida y normaliza un código leído por cámara o ingresado manualmente.
 */
export function parseScannedGtin(rawInput: string, formatHint?: string): GtinValidationResult {
  const rawDigits = rawInput.replace(/\D/g, '');
  if (!rawDigits) {
    return { status: 'invalid', rawDigits: '', reason: 'empty' };
  }

  const fmt = (formatHint ?? '').toLowerCase();

  // Caso UPC-E explícito o 8 dígitos que expanden a UPC-A válido
  if (fmt.includes('upc_e') || (rawDigits.length === 8 && !hasValidGs1Checksum(rawDigits))) {
    const expanded12 = expandUpcEToUpcA(rawDigits);
    if (expanded12) {
      const ean13 = `0${expanded12}`;
      return {
        status: 'valid',
        canonicalEan: ean13,
        lookupCandidates: [ean13, expanded12, rawDigits],
        rawDigits,
      };
    }
  }

  const len = rawDigits.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) {
    return { status: 'invalid', rawDigits, reason: 'length' };
  }

  if (!hasValidGs1Checksum(rawDigits)) {
    return { status: 'invalid', rawDigits, reason: 'checksum' };
  }

  // Prefijos 20-29 en EAN-13 corresponden a etiquetas internas de balanza / peso variable
  if (len === 13 && rawDigits[0] === '2') {
    return {
      status: 'weighable',
      canonicalEan: rawDigits,
      rawDigits,
    };
  }

  if (len === 12) {
    const padded13 = `0${rawDigits}`;
    return {
      status: 'valid',
      canonicalEan: padded13,
      lookupCandidates: [padded13, rawDigits],
      rawDigits,
    };
  }

  if (len === 14 && rawDigits.startsWith('0')) {
    const ean13 = rawDigits.slice(1);
    return {
      status: 'valid',
      canonicalEan: ean13,
      lookupCandidates: [ean13, rawDigits],
      rawDigits,
    };
  }

  // Si es EAN-13 que empieza con 0 (UPC-A almacenado como 13 o 12 dígitos), buscar ambas variantes
  if (len === 13 && rawDigits.startsWith('0')) {
    return {
      status: 'valid',
      canonicalEan: rawDigits,
      lookupCandidates: [rawDigits, rawDigits.slice(1)],
      rawDigits,
    };
  }

  return {
    status: 'valid',
    canonicalEan: rawDigits,
    lookupCandidates: [rawDigits],
    rawDigits,
  };
}

/**
 * Usado al construir el catálogo diario para descartar itemIds internos sin código de barras real.
 */
export function normalizeCatalogEan(raw?: string | number | null): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13 && digits.length !== 14) {
    return null;
  }
  if (!hasValidGs1Checksum(digits)) return null;
  if (digits.length === 12) return `0${digits}`;
  if (digits.length === 14 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
