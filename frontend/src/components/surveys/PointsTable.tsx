import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  ApiError,
  type NetworkObservation,
  type ScanDetailResponse,
  type ScanHistoryRecord,
} from '../../types/api';
import { getScanDetail } from '../../lib/api';
import { isWeakRssi, rssiColor } from '../../lib/signal';
import { formatConsoleCell, formatMbps } from '../../lib/format';

export type PointRow = {
  id: string;
  planId: string;
  surveyId: string | null;
  x: number;
  y: number;
  note: string | null;
  isEnabled: number;
  createdAt: string;
  rssi: number | null;
  networks: number;
  scannedAt: string | null;
  ping: number | null;
  down: number | null;
  up: number | null;
  scans: ScanHistoryRecord[];
};

type SortKey = 'index' | 'rssi' | 'networks' | 'ping' | 'down';

type Props = {
  surveyName: string;
  rows: PointRow[];
  onBack: () => void;
};

function num(v: number | null): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; detail: ScanDetailResponse };

type FlatRow = {
  key: string;
  pointN: number;
  x: number;
  y: number;
  networks: number;
  ping: number | null;
  down: number | null;
  up: number | null;
  scannedAt: string | null;
  obsIndex: number | null;
  obs: NetworkObservation | null;
  loading: boolean;
  noScan: boolean;
};

/* Tableau aplati unique : 1 ligne par (point × réseau du dernier scan),
   mêmes colonnes et même format que backend/tests/parser.json. */
export function PointsTable({ surveyName, rows, onBack }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('index');
  const [asc, setAsc] = useState(true);
  const [weakOnly, setWeakOnly] = useState(false);
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const loadScanDetail = useCallback(async (scanId: string) => {
    setDetails((current) => {
      if (current[scanId]?.status === 'loaded' || current[scanId]?.status === 'loading') {
        return current;
      }
      return { ...current, [scanId]: { status: 'loading' } };
    });
    try {
      const detail = await getScanDetail(scanId);
      setDetails((current) => ({ ...current, [scanId]: { status: 'loaded', detail } }));
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Impossible de charger les données du scan.';
      setDetails((current) => ({ ...current, [scanId]: { status: 'error', message } }));
    }
  }, []);

  useEffect(() => {
    for (const row of rows) {
      const latest = row.scans.at(-1)?.id;
      if (latest) void loadScanDetail(latest);
    }
  }, [rows, loadScanDetail]);

  const flat = useMemo(() => {
    const out: FlatRow[] = [];
    rows.forEach((r, i) => {
      const pointN = i + 1;
      const base = {
        pointN,
        x: r.x,
        y: r.y,
        networks: r.networks,
        ping: r.ping,
        down: r.down,
        up: r.up,
        scannedAt: r.scannedAt,
      };
      const latestId = r.scans.at(-1)?.id;
      if (!latestId) {
        out.push({
          ...base,
          key: `${r.id}-noscan`,
          obsIndex: null,
          obs: null,
          loading: false,
          noScan: true,
        });
        return;
      }
      const state = details[latestId];
      if (state?.status !== 'loaded') {
        out.push({
          ...base,
          key: `${r.id}-loading`,
          obsIndex: null,
          obs: null,
          loading: state?.status === 'loading',
          noScan: false,
        });
        return;
      }
      if (state.detail.observations.length === 0) {
        out.push({
          ...base,
          key: `${r.id}-empty`,
          obsIndex: null,
          obs: null,
          loading: false,
          noScan: false,
        });
        return;
      }
      state.detail.observations.forEach((obs, obsIndex) => {
        out.push({
          ...base,
          key: `${r.id}-${obs.bssid}-${obsIndex}`,
          obsIndex,
          obs,
          loading: false,
          noScan: false,
        });
      });
    });

    const filtered = weakOnly ? out.filter((f) => f.obs && isWeakRssi(f.obs.rssi)) : out;

    const get = (f: FlatRow): number => {
      switch (sortKey) {
        case 'rssi':
          return num(f.obs?.rssi ?? null);
        case 'networks':
          return f.networks;
        case 'ping':
          return num(f.ping);
        case 'down':
          return num(f.down);
        default:
          return 0;
      }
    };
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'index') {
        if (a.pointN !== b.pointN) return asc ? a.pointN - b.pointN : b.pointN - a.pointN;
        return asc
          ? (a.obsIndex ?? -1) - (b.obsIndex ?? -1)
          : (b.obsIndex ?? -1) - (a.obsIndex ?? -1);
      }
      return asc ? get(a) - get(b) : get(b) - get(a);
    });
    return sorted;
  }, [rows, details, sortKey, asc, weakOnly]);

  const loadedCount = useMemo(
    () =>
      rows.filter((r) => {
        const latest = r.scans.at(-1)?.id;
        return latest && details[latest]?.status === 'loaded';
      }).length,
    [rows, details],
  );

  const header = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-left text-[12px] text-text-dim font-medium whitespace-nowrap">
      <button
        type="button"
        onClick={() => {
          if (sortKey === key) setAsc(!asc);
          else {
            setSortKey(key);
            setAsc(true);
          }
        }}
        aria-label={`Trier par ${label}`}
        className="inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {label} {sortKey === key ? (asc ? '↑' : '↓') : ''}
      </button>
    </th>
  );

  const th = (label: string) => (
    <th className="px-3 py-2 text-left text-[12px] text-text-dim font-medium whitespace-nowrap">
      {label}
    </th>
  );

  const scannedLabel = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28">
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour aux surveys"
          className="w-10 h-10 rounded-[10px] border border-glass-border-soft text-text-dim flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.75} aria-hidden />
        </button>
        <div className="min-w-0">
          <h1 className="text-[18px] font-medium text-text truncate">Points · {surveyName}</h1>
          <p className="text-[12px] text-text-dim">
            {flat.length} mesure{flat.length > 1 ? 's' : ''} · {rows.length} point
            {rows.length > 1 ? 's' : ''}
            {loadedCount < rows.length && ` · chargement ${loadedCount}/${rows.length}`}
          </p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-[13px] text-text-dim shrink-0">
          <input
            type="checkbox"
            checked={weakOnly}
            onChange={(e) => setWeakOnly(e.target.checked)}
            className="w-4 h-4 accent-accent"
          />
          Signaux faibles seulement
        </label>
      </div>

      <div className="overflow-x-auto rounded-[14px] border-[0.5px] border-[rgba(255,255,255,0.08)]">
        <table className="min-w-full text-[13px]">
          <thead className="bg-[rgba(255,255,255,0.03)]">
            <tr>
              <th className="px-3 py-2 text-left text-[12px] text-text-dim font-medium sticky left-0 bg-bg whitespace-nowrap">
                Point
              </th>
              {th('(index)')}
              {th('BSSID')}
              {th('SSID')}
              {th('Bande')}
              {th('Canal')}
              {th('Largeur')}
              {header('rssi', 'RSSI')}
              {th('Qualité')}
              {th('Sécurité')}
              {th('Standard')}
              {header('networks', 'Réseaux')}
              {header('ping', 'Ping')}
              {header('down', 'Débit ↓ / ↑')}
              {th('Dernier scan')}
            </tr>
          </thead>
          <tbody>
            {flat.length === 0 && (
              <tr className="border-t border-glass-border-soft">
                <td colSpan={15} className="px-3 py-8 text-center text-[13px] text-text-dim">
                  {weakOnly ? 'Aucun signal faible.' : 'Aucune mesure.'}
                </td>
              </tr>
            )}
            {flat.map((f) => (
              <tr key={f.key} className="border-t border-glass-border-soft">
                <td className="px-3 py-2 font-mono text-text sticky left-0 bg-bg whitespace-nowrap">
                  {f.pointN} · {(f.x * 100).toFixed(0)}% / {(f.y * 100).toFixed(0)}%
                </td>
                {f.noScan ? (
                  <td colSpan={11} className="px-3 py-2 font-mono text-text-dim">
                    Aucun scan enregistré.
                  </td>
                ) : f.loading || !f.obs ? (
                  <td colSpan={11} className="px-3 py-2 font-mono text-text-dim">
                    {f.loading ? 'Chargement des observations…' : '—'}
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 font-mono text-text-dim">{f.obsIndex}</td>
                    <td className="px-3 py-2 font-mono text-text whitespace-nowrap">
                      {formatConsoleCell(f.obs.bssid_name)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                      {formatConsoleCell(f.obs.ssid)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                      {formatConsoleCell(f.obs.band)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim">
                      {formatConsoleCell(f.obs.channel)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                      {`${formatConsoleCell(f.obs.bandwidth_mhz)} MHz`}
                    </td>
                    <td
                      className="px-3 py-2 font-mono whitespace-nowrap"
                      style={{ color: rssiColor(f.obs.rssi) }}
                    >
                      {`${f.obs.rssi} dBm`}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim">{f.obs.quality}</td>
                    <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                      {formatConsoleCell(f.obs.security)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                      {formatConsoleCell(f.obs.standard)}
                    </td>
                  </>
                )}
                <td className="px-3 py-2 font-mono text-text-dim">{f.networks}</td>
                <td className="px-3 py-2 font-mono text-text-dim">
                  {f.ping === null ? '—' : `${f.ping} ms`}
                </td>
                <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                  {f.down === null && f.up === null
                    ? '—'
                    : `↓ ${f.down === null ? '—' : formatMbps(f.down)} · ↑ ${f.up === null ? '—' : formatMbps(f.up)}`}
                </td>
                <td className="px-3 py-2 font-mono text-text-dim whitespace-nowrap">
                  {scannedLabel(f.scannedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
