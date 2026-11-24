import { ChevronRight, Store } from 'lucide-react';
import { Branch, SyncStatus } from '../types/models';

interface BranchBarProps {
  branch: Branch;
  sync: SyncStatus;
  showLeadingIcon?: boolean;
  onOpenBranches: () => void;
}

export function BranchBar({
  branch,
  sync,
  showLeadingIcon = false,
  onOpenBranches,
}: BranchBarProps) {
  const isOffline = sync.mode === 'offline';
  const isStale = sync.mode === 'stale';
  const isGpsAlert = sync.gpsState === 'denied' || sync.gpsState === 'approximate';

  const statusText = isOffline
    ? `${branch.address} · Sin señal · Precios guardados`
    : isStale
      ? `${branch.address} · Precios de ayer · Actualizar`
      : `${branch.address} · Precios de hoy, ${sync.lastSyncTime}`;

  return (
    <button
      type="button"
      className={`branch-bar${isGpsAlert ? ' alert-gps' : ''}`}
      onClick={onOpenBranches}
      aria-label={`Cambiar sucursal activa: Sucursal ${branch.name}`}
    >
      <div className="branch-bar-leading">
        {showLeadingIcon && (
          <div className="branch-icon-box" aria-hidden="true">
            <Store size={19} strokeWidth={1.9} />
          </div>
        )}
        <div className="branch-text">
          <div className="branch-name">Sucursal {branch.name}</div>
          <div className="branch-meta">
            <span
              className={`status-dot ${isOffline ? 'offline' : isStale ? 'stale' : 'online'}`}
              aria-hidden="true"
            />
            <span>{statusText}</span>
          </div>
        </div>
      </div>
      <ChevronRight size={20} color="#5C5E66" aria-hidden="true" />
    </button>
  );
}
