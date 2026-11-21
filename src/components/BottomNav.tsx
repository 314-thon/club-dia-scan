import { ReceiptText, ScanQrCode, SlidersHorizontal, Store, Tag } from 'lucide-react';
import { TabId } from '../types/models';

interface BottomNavProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

export function BottomNav({ activeTab, onSelectTab }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      <button
        type="button"
        className={`nav-tab${activeTab === 'inicio' ? ' active' : ''}`}
        aria-current={activeTab === 'inicio' ? 'page' : undefined}
        onClick={() => onSelectTab('inicio')}
      >
        <Store size={22} strokeWidth={1.9} aria-hidden="true" />
        <span>Inicio</span>
      </button>

      <button
        type="button"
        className={`nav-tab${activeTab === 'ofertas' ? ' active' : ''}`}
        aria-current={activeTab === 'ofertas' ? 'page' : undefined}
        onClick={() => onSelectTab('ofertas')}
      >
        <Tag size={22} strokeWidth={1.9} aria-hidden="true" />
        <span>Ofertas</span>
      </button>

      <div className="nav-scan-slot">
        <button
          type="button"
          className="nav-scan-btn"
          aria-label="Escanear código de barras o QR"
          onClick={() => onSelectTab('escaner')}
        >
          <ScanQrCode size={24} strokeWidth={2} aria-hidden="true" />
          <span>Escanear</span>
        </button>
      </div>

      <button
        type="button"
        className={`nav-tab${activeTab === 'historial' ? ' active' : ''}`}
        aria-current={activeTab === 'historial' ? 'page' : undefined}
        onClick={() => onSelectTab('historial')}
      >
        <ReceiptText size={22} strokeWidth={1.9} aria-hidden="true" />
        <span>Historial</span>
      </button>

      <button
        type="button"
        className={`nav-tab${activeTab === 'preferencias' ? ' active' : ''}`}
        aria-current={activeTab === 'preferencias' ? 'page' : undefined}
        onClick={() => onSelectTab('preferencias')}
      >
        <SlidersHorizontal size={22} strokeWidth={1.9} aria-hidden="true" />
        <span>Preferencias</span>
      </button>
    </nav>
  );
}
