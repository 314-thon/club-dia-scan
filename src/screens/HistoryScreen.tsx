import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ReceiptText,
  TrendingUp,
} from 'lucide-react';
import { MonthHistory, Ticket } from '../types/models';
import { formatARS, formatPctDecimal } from '../utils/format';

interface HistoryScreenProps {
  months: MonthHistory[];
  onSelectTicket: (ticket: Ticket) => void;
}

export function HistoryScreen({ months, onSelectTicket }: HistoryScreenProps) {
  const [monthIdx, setMonthIdx] = useState(1); // Noviembre 2026
  const [selectedBranch, setSelectedBranch] = useState<string>('Todas');

  const currentMonth = months[monthIdx] ?? months[0];

  const branchCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of currentMonth.tickets) {
      map.set(t.branchName, (map.get(t.branchName) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [currentMonth]);

  const filteredTickets = useMemo(() => {
    if (selectedBranch === 'Todas') return currentMonth.tickets;
    return currentMonth.tickets.filter((t) => t.branchName === selectedBranch);
  }, [currentMonth, selectedBranch]);

  const totalSpent = useMemo(
    () => filteredTickets.reduce((sum, t) => sum + t.total, 0),
    [filteredTickets]
  );
  const totalSaved = useMemo(
    () => filteredTickets.reduce((sum, t) => sum + t.saved, 0),
    [filteredTickets]
  );
  const savedPct =
    totalSpent + totalSaved > 0 ? (totalSaved / (totalSpent + totalSaved)) * 100 : 0;
  const distinctBranches = useMemo(
    () => new Set(filteredTickets.map((t) => t.branchName)).size,
    [filteredTickets]
  );

  const handleChangeMonth = (delta: number) => {
    const next = monthIdx + delta;
    if (next < 0 || next >= months.length) return;
    setMonthIdx(next);
    setSelectedBranch('Todas');
  };

  const handleDownloadPdf = () => {
    const printWin = window.open('', '_blank', 'width=640,height=800');
    if (!printWin) {
      window.print();
      return;
    }

    const rowsHtml = filteredTickets
      .map(
        (t) =>
          `<tr>
            <td style="padding:10px;border-bottom:1px solid #E4E2DC">${t.dateLabel}</td>
            <td style="padding:10px;border-bottom:1px solid #E4E2DC">${t.branchName}</td>
            <td style="padding:10px;border-bottom:1px solid #E4E2DC;text-align:right">${t.productCount}</td>
            <td style="padding:10px;border-bottom:1px solid #E4E2DC;text-align:right;font-family:monospace">${formatARS(t.total)}</td>
            <td style="padding:10px;border-bottom:1px solid #E4E2DC;text-align:right;font-family:monospace;color:#166B45">${formatARS(t.saved)}</td>
          </tr>`
      )
      .join('');

    printWin.document.write(`<!doctype html>
      <html lang="es-AR">
        <head>
          <meta charset="utf-8" />
          <title>Comprobantes Club Dia — ${currentMonth.label}</title>
          <style>
            body { font-family: system-ui, sans-serif; color: #18181B; padding: 32px; }
            h1 { color: #C81E2B; margin: 0 0 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { text-align: left; padding: 10px; border-bottom: 2px solid #18181B; font-size: 13px; }
          </style>
        </head>
        <body>
          <h1>Club Dia — Resumen de compras</h1>
          <p>${currentMonth.label} · Ahorro total: <strong style="color:#166B45">${formatARS(totalSaved)}</strong> · Gastado: <strong>${formatARS(totalSpent)}</strong></p>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Sucursal</th>
                <th style="text-align:right">Productos</th>
                <th style="text-align:right">Total</th>
                <th style="text-align:right">Ahorro</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>`);
    printWin.document.close();
  };

  return (
    <main className="screen-scroll">
      <header className="screen-header">
        <h1 className="screen-title">Tus compras del mes</h1>
      </header>

      <div className="month-bar" role="group" aria-label="Selector de mes">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mes anterior"
          disabled={monthIdx === 0}
          style={{ opacity: monthIdx === 0 ? 0.35 : 1 }}
          onClick={() => handleChangeMonth(-1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="month-label">{currentMonth.label}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Mes siguiente"
          disabled={monthIdx === months.length - 1}
          style={{ opacity: monthIdx === months.length - 1 ? 0.35 : 1 }}
          onClick={() => handleChangeMonth(1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      {currentMonth.tickets.length === 0 ? (
        <section className="card empty-state">
          <ReceiptText size={32} color="#5C5E66" strokeWidth={1.6} aria-hidden="true" />
          <h2 style={{ fontSize: 18 }}>Todavía no tenés compras en {currentMonth.shortName}</h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--slate)' }}>
            Cuando pases por caja con tu DNI o el QR de Club Dia, tus tickets y tu ahorro aparecen
            acá automáticamente.
          </p>
        </section>
      ) : (
        <>
          <section className="card" aria-label="Resumen de compras y ahorro">
            <div className="savings-label">Ahorraste con Club Dia</div>
            <div className="savings-amount">{formatARS(totalSaved)}</div>
            <div>
              <span className="pill-pine">
                <TrendingUp size={15} aria-hidden="true" />
                <span>{formatPctDecimal(savedPct)} menos que el precio de lista</span>
              </span>
            </div>

            <div className="summary-stats-grid">
              <div>
                <div className="stat-label">Gastaste</div>
                <div className="stat-value-mono">{formatARS(totalSpent)}</div>
              </div>
              <div>
                <div className="stat-label">Compras</div>
                <div className="stat-value-body">
                  {filteredTickets.length}{' '}
                  {filteredTickets.length === 1 ? 'ticket' : 'tickets'} · {distinctBranches}{' '}
                  {distinctBranches === 1 ? 'sucursal' : 'sucursales'}
                </div>
              </div>
            </div>
          </section>

          <div className="chips-strip" role="tablist" aria-label="Filtrar tickets por sucursal">
            <button
              type="button"
              role="tab"
              aria-selected={selectedBranch === 'Todas'}
              className={`chip${selectedBranch === 'Todas' ? ' active' : ''}`}
              onClick={() => setSelectedBranch('Todas')}
            >
              Todas ({currentMonth.tickets.length})
            </button>
            {branchCounts.map(([bName, count]) => (
              <button
                key={bName}
                type="button"
                role="tab"
                aria-selected={selectedBranch === bName}
                className={`chip${selectedBranch === bName ? ' active' : ''}`}
                onClick={() => setSelectedBranch(bName)}
              >
                {bName} ({count})
              </button>
            ))}
          </div>

          <section aria-label={`Tickets de ${currentMonth.shortName}`}>
            <div className="section-row" style={{ marginBottom: 10 }}>
              <h2 className="section-heading">Tickets de {currentMonth.shortName}</h2>
              <span className="section-count">
                {filteredTickets.length} {filteredTickets.length === 1 ? 'compra' : 'compras'}
              </span>
            </div>

            <div className="card-flush">
              {filteredTickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className="ticket-row"
                  onClick={() => onSelectTicket(ticket)}
                >
                  <div style={{ minInlineSize: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink)' }}>
                      {ticket.dateLabel}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--slate)', marginTop: 2 }}>
                      {ticket.branchName} · {ticket.productCount} productos
                    </div>
                  </div>
                  <div className="ticket-right">
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: 16, fontWeight: 700 }}>
                        {formatARS(ticket.total)}
                      </div>
                      <div className="saving-inline" style={{ fontSize: 12.5, marginTop: 2 }}>
                        Ahorraste {formatARS(ticket.saved)}
                      </div>
                    </div>
                    <ChevronRight size={18} color="#5C5E66" aria-hidden="true" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <button type="button" className="btn-secondary" onClick={handleDownloadPdf}>
            <Download size={18} aria-hidden="true" />
            <span>Descargar comprobantes (PDF)</span>
          </button>

          <p style={{ margin: 0, textAlign: 'center', fontSize: 12.5, color: 'var(--slate)' }}>
            Tus compras aparecen acá después de pasar por caja con tu tarjeta.
          </p>
        </>
      )}
    </main>
  );
}
