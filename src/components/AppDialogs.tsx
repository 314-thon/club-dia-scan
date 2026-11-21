import { useState } from 'react';
import {
  Check,
  Loader2,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { ModalDialog } from './ModalDialog';
import { Branch, Product, Ticket, VisitItem } from '../types/models';
import { QUICK_TEST_EANS } from '../data/seedData';
import { calcBranchVariant, formatARS } from '../utils/format';

export type ActiveDialog =
  | null
  | { type: 'card' }
  | { type: 'branches' }
  | { type: 'manual-ean' }
  | { type: 'visit-list' }
  | { type: 'ticket'; ticket: Ticket }
  | { type: 'other-branches'; product: Product }
  | { type: 'notifications' }
  | { type: 'privacy' };

interface AppDialogsProps {
  dialog: ActiveDialog;
  onClose: () => void;
  branches: Branch[];
  activeBranch: Branch;
  onSelectBranch: (branch: Branch) => void;
  onLocateBranches: () => Promise<void>;
  locatingBranches: boolean;
  gpsMessage: string | null;
  onLookupEan: (ean: string) => Promise<void>;
  lookingUpEan: boolean;
  visitItems: VisitItem[];
  onUpdateVisitQty: (ean: string, delta: number) => void;
  onClearVisit: () => void;
  onOpenProduct: (product: Product) => void;
  isOffline: boolean;
}

export function AppDialogs({
  dialog,
  onClose,
  branches,
  activeBranch,
  onSelectBranch,
  onLocateBranches,
  locatingBranches,
  gpsMessage,
  onLookupEan,
  lookingUpEan,
  visitItems,
  onUpdateVisitQty,
  onClearVisit,
  onOpenProduct,
  isOffline,
}: AppDialogsProps) {
  const [eanInput, setEanInput] = useState('');

  const visitTotal = visitItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const visitSavings = visitItems.reduce(
    (sum, item) => sum + item.product.savings * item.quantity,
    0
  );

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = eanInput.replace(/\D/g, '');
    if (!cleaned) return;
    await onLookupEan(cleaned);
    setEanInput('');
  };

  return (
    <>
      <ModalDialog open={dialog?.type === 'card'} title="Mi tarjeta Club Dia" onClose={onClose}>
        <div className="qr-box">
          <div
            style={{
              width: 172,
              height: 172,
              borderRadius: 14,
              background: '#FFFFFF',
              border: '1px solid var(--hairline)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink)',
            }}
            aria-label="Código QR de socia Club Dia"
          >
            <QrCode size={136} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="mono" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.06em' }}>
              2900 4821 9045
            </div>
            <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 4 }}>
              Mostrá este código o decí tu DNI en caja para aplicar los descuentos vigentes.
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 13.5,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--pine-tint)',
            color: 'var(--pine)',
            fontWeight: 600,
          }}
        >
          <span>Sucursal activa</span>
          <span>{activeBranch.name}</span>
        </div>
      </ModalDialog>

      <ModalDialog open={dialog?.type === 'branches'} title="Elegí tu sucursal" onClose={onClose}>
        <button
          type="button"
          className="btn-secondary"
          onClick={onLocateBranches}
          disabled={locatingBranches || isOffline}
          style={{ opacity: locatingBranches || isOffline ? 0.65 : 1 }}
        >
          {locatingBranches ? (
            <Loader2 size={18} aria-hidden="true" />
          ) : (
            <LocateFixed size={18} aria-hidden="true" />
          )}
          <span>
            {locatingBranches
              ? 'Buscando sucursales cercanas...'
              : 'Detectar sucursal cercana por GPS'}
          </span>
        </button>

        {gpsMessage && (
          <div className="amber-banner" role="status">
            <MapPin size={18} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
            <span>{gpsMessage}</span>
          </div>
        )}

        <div className="card-flush">
          {branches.map((branch) => {
            const selected = branch.id === activeBranch.id;
            return (
              <button
                key={branch.id}
                type="button"
                className="habitual-row"
                onClick={() => {
                  onSelectBranch(branch);
                  onClose();
                }}
              >
                <div style={{ minInlineSize: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                    {branch.name}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 2 }}>
                    {branch.address}
                    {branch.distanceKm !== undefined ? ` · a ${branch.distanceKm} km` : ''}
                  </div>
                </div>
                {selected ? (
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      background: 'var(--pine-tint)',
                      color: 'var(--pine)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                    aria-label="Seleccionada"
                  >
                    <Check size={16} strokeWidth={2.4} aria-hidden="true" />
                  </span>
                ) : branch.source === 'dia-live' ? (
                  <span className="source-tag">En vivo</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </ModalDialog>

      <ModalDialog
        open={dialog?.type === 'manual-ean'}
        title="Escribir código del producto"
        onClose={onClose}
      >
        <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label htmlFor="ean-input" style={{ fontSize: 13.5, color: 'var(--slate)' }}>
            Ingresá el código de barras (EAN-13) que figura debajo de las líneas en el envase.
          </label>
          <div className="search-box">
            <Search size={18} color="#5C5E66" aria-hidden="true" />
            <input
              id="ean-input"
              className="search-input mono"
              inputMode="numeric"
              placeholder="Ej: 7790742363008"
              value={eanInput}
              onChange={(e) => setEanInput(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn-primary" disabled={lookingUpEan}>
            {lookingUpEan ? 'Consultando en Dia...' : 'Consultar precio'}
          </button>
        </form>

        <hr className="divider" />

        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--slate)', marginBottom: 8 }}>
            Códigos reales para probar ahora
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {QUICK_TEST_EANS.map((sample) => (
              <button
                key={sample.ean}
                type="button"
                className="sidebar-btn"
                onClick={() => onLookupEan(sample.ean)}
                disabled={lookingUpEan}
              >
                <span style={{ fontSize: 13 }}>{sample.label}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--slate)' }}>
                  {sample.ean}
                </span>
              </button>
            ))}
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={dialog?.type === 'visit-list'}
        title={`Tu lista en ${activeBranch.name}`}
        onClose={onClose}
      >
        {visitItems.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink)' }}>
              Todavía no guardaste productos en esta visita.
            </p>
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Escaneá o buscá cualquier producto para calcular tu total antes de llegar a caja.
            </p>
          </div>
        ) : (
          <>
            <div className="card-flush">
              {visitItems.map((item) => (
                <div key={item.product.ean} style={{ padding: 12, borderTop: '1px solid var(--hairline)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button
                      type="button"
                      style={{ textAlign: 'left', flex: 1, minInlineSize: 0 }}
                      onClick={() => {
                        onClose();
                        onOpenProduct(item.product);
                      }}
                    >
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{item.product.name}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                        <span className="mono" style={{ fontSize: 14.5, fontWeight: 700 }}>
                          {formatARS(item.product.price * item.quantity)}
                        </span>
                        {item.product.savings > 0 && (
                          <span className="saving-inline">
                            Ahorrás {formatARS(item.product.savings * item.quantity)}
                          </span>
                        )}
                      </div>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 40, height: 40, minInlineSize: 40, minBlockSize: 40 }}
                        aria-label={`Quitar una unidad de ${item.product.name}`}
                        onClick={() => onUpdateVisitQty(item.product.ean, -1)}
                      >
                        {item.quantity === 1 ? (
                          <Trash2 size={16} color="#5C5E66" aria-hidden="true" />
                        ) : (
                          <Minus size={16} aria-hidden="true" />
                        )}
                      </button>
                      <span className="mono" style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 40, height: 40, minInlineSize: 40, minBlockSize: 40 }}
                        aria-label={`Sumar una unidad de ${item.product.name}`}
                        onClick={() => onUpdateVisitQty(item.product.ean, 1)}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pine-callout" style={{ marginTop: 0, justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>Total estimado en caja</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
                  {formatARS(visitTotal)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12.5, color: 'var(--pine)' }}>Ahorro Club Dia</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--pine)' }}>
                  {formatARS(visitSavings)}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClearVisit();
                onClose();
              }}
            >
              Vaciar lista de esta visita
            </button>
          </>
        )}
      </ModalDialog>

      <ModalDialog
        open={dialog?.type === 'ticket'}
        title={dialog?.type === 'ticket' ? `Ticket · ${dialog.ticket.dateLabel}` : 'Detalle'}
        onClose={onClose}
      >
        {dialog?.type === 'ticket' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--slate)' }}>
              Sucursal {dialog.ticket.branchName} · {dialog.ticket.productCount} productos
            </div>
            <div className="card-flush">
              {dialog.ticket.items.map((line, idx) => (
                <div
                  key={`${dialog.ticket.id}-${idx}`}
                  style={{
                    padding: '12px 14px',
                    borderTop: idx === 0 ? 0 : '1px solid var(--hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ minInlineSize: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{line.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>
                      {line.qty} {line.qty === 1 ? 'unidad' : 'unidades'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 14.5, fontWeight: 700 }}>
                      {formatARS(line.price)}
                    </div>
                    {line.saved > 0 && (
                      <div className="saving-inline" style={{ fontSize: 12 }}>
                        -{formatARS(line.saved)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: 14,
                background: 'var(--pine-tint)',
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>Pagaste</div>
                <div className="mono" style={{ fontSize: 19, fontWeight: 700 }}>
                  {formatARS(dialog.ticket.total)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12.5, color: 'var(--pine)' }}>Ahorraste con Club Dia</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--pine)' }}>
                  {formatARS(dialog.ticket.saved)}
                </div>
              </div>
            </div>
          </>
        )}
      </ModalDialog>

      <ModalDialog
        open={dialog?.type === 'other-branches'}
        title="Precio en otras sucursales"
        onClose={onClose}
      >
        {dialog?.type === 'other-branches' && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{dialog.product.name}</div>
            <div className="card-flush">
              {branches.slice(0, 4).map((b) => {
                const variant = calcBranchVariant(dialog.product, b.id);
                return (
                  <div key={b.id} className="habitual-row" style={{ cursor: 'default' }}>
                    <div style={{ minInlineSize: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{b.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--slate)' }}>{variant.note}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                        <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
                          {formatARS(variant.price)}
                        </span>
                        {variant.discountPct > 0 && (
                          <span className="discount-badge">-{variant.discountPct}%</span>
                        )}
                      </div>
                      {variant.savings > 0 && (
                        <div className="saving-inline" style={{ fontSize: 12, marginTop: 2 }}>
                          Ahorrás {formatARS(variant.savings)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onClose();
              }}
            >
              Entendido
            </button>
          </>
        )}
      </ModalDialog>

      <ModalDialog open={dialog?.type === 'notifications'} title="Avisos de hoy" onClose={onClose}>
        <div className="card-flush">
          <div style={{ padding: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>
              3 habituales con descuento en {activeBranch.name}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--slate)' }}>
              Yerba Mate Playadito, Leche La Serenísima y Yogur Ser tienen cupón activo hasta el 23/11.
            </p>
          </div>
          <div style={{ padding: 14, borderTop: '1px solid var(--hairline)' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Catálogo Dia sincronizado</div>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--slate)' }}>
              Los precios escaneados quedan guardados en tu teléfono para consultarlos aunque pierdas señal en góndola.
            </p>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={dialog?.type === 'privacy'}
        title="Tus derechos (Ley 25.326)"
        onClose={onClose}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <ShieldCheck size={22} color="#166B45" style={{ flexShrink: 0 }} aria-hidden="true" />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>
            Conforme a la Ley Nacional 25.326 de Protección de Datos Personales, podés consultar,
            rectificar o pausar en cualquier momento el uso de tu historial de tickets para
            personalizar ofertas.
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--slate)' }}>
          La ubicación solo se consulta mientras elegís sucursal o si activás el aviso al llegar a
          una tienda. No compartimos tu ubicación con terceros.
        </p>
        <button type="button" className="btn-primary" onClick={onClose}>
          Entendido
        </button>
      </ModalDialog>
    </>
  );
}
