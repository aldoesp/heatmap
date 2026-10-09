import { useCallback, useEffect, useState } from 'react';
import { usePlanImage } from '../../hooks/usePlanImage';
import {
  getStatus,
  getSettings,
  patchSetting,
  getIperfStatus,
  listBssidRules,
  createBssidRule,
  updateBssidRule,
  deleteBssidRule,
  exportCsvUrl,
  type BssidRule,
  type AppSettings,
  type AppStatus,
} from '../../lib/api';
import { ApiError } from '../../types/api';

const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function SettingsPage() {
  const { plan, loading: planLoading } = usePlanImage();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [iperf, setIperf] = useState<{ available: boolean; version: string | null } | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ iperf_server: '', iperf_duration_s: '', scan_mode: '' });
  const [switchingMode, setSwitchingMode] = useState(false);
  const [mappings, setMappings] = useState<BssidRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mapName, setMapName] = useState('');
  const [mapBssid, setMapBssid] = useState('');
  const [blacklistNew, setBlacklistNew] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleName, setEditingRuleName] = useState('');
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [st, se, ip] = await Promise.all([
          getStatus(),
          getSettings(),
          getIperfStatus().catch(() => null),
        ]);
        if (!alive) return;
        setStatus(st);
        setSettings(se);
        setIperf(ip);
      } catch (err) {
        if (!alive) return;
        const apiErr = err instanceof ApiError ? err : null;
        setError(apiErr?.message ?? 'Impossible de charger les paramètres.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    listBssidRules()
      .then((m) => {
        if (alive) setMappings(m);
      })
      .catch((err) => {
        if (!alive) return;
        const apiErr = err instanceof ApiError ? err : null;
        setMapError(apiErr?.message ?? 'Impossible de charger les règles BSSID.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const duration = settings.iperf_duration_s.trim() || '5';
      await patchSetting('iperf_server', settings.iperf_server.trim());
      await patchSetting('iperf_duration_s', duration);
      setSettings((s) => ({ ...s, iperf_duration_s: duration }));
      setInfo('Réglages enregistrés.');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible d’enregistrer les réglages.');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const addMapping = useCallback(async () => {
    const name = mapName.trim();
    const bssid = mapBssid.trim().toLowerCase();
    if (!name && !blacklistNew) {
      setMapError('Donne un nom ou ajoute ce BSSID à la liste noire.');
      return;
    }
    if (!BSSID_RE.test(bssid)) {
      setMapError('Adresse MAC invalide (ex. 9e:05:d6:96:e8:30).');
      return;
    }
    setMapError(null);
    try {
      const created = await createBssidRule({ name, bssid, blacklisted: blacklistNew });
      setMappings((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setMapName('');
      setMapBssid('');
      setBlacklistNew(false);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible d’ajouter cette borne.');
    }
  }, [mapName, mapBssid, blacklistNew]);

  const removeMapping = useCallback(async (id: string) => {
    try {
      await deleteBssidRule(id);
      setMappings((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de supprimer cette borne.');
    }
  }, []);

  const toggleBlacklist = useCallback(async (rule: BssidRule) => {
    try {
      const updated = await updateBssidRule(rule.id, { blacklisted: !rule.blacklisted });
      setMappings((prev) => prev.map((item) => item.id === rule.id ? updated : item));
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de modifier la liste noire.');
    }
  }, []);

  const saveRuleName = useCallback(async (rule: BssidRule) => {
    try {
      const updated = await updateBssidRule(rule.id, { name: editingRuleName.trim() });
      setMappings((prev) => prev.map((item) => item.id === rule.id ? updated : item));
      setEditingRuleId(null);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de modifier le nom.');
    }
  }, [editingRuleName]);

  const switchMode = useCallback(async (mode: 'test' | 'live') => {
    setSwitchingMode(true);
    setError(null);
    setInfo(null);
    try {
      await patchSetting('scan_mode', mode);
      setSettings((s) => ({ ...s, scan_mode: mode }));
      setStatus((st) => (st ? { ...st, scan_mode: mode } : st));
      setInfo(mode === 'live' ? 'Mode réel activé : les scans utilisent Termux:API.' : 'Mode test activé : les scans utilisent les données simulées.');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de changer de mode.');
    } finally {
      setSwitchingMode(false);
    }
  }, []);

  if (planLoading || loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  return (
    <div className="max-w-300 mx-auto px-4 pt-6 pb-28 md:pb-8 lg:px-6 lg:py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-medium tracking-tight mb-1">Paramètres</h1>
        <p className="text-text-dim text-sm">
          {status
            ? `Mode ${status.scan_mode === 'test' ? 'test (données simulées)' : 'réel (Termux:API)'} · ${status.platform} · Node ${status.node}`
            : 'Serveur injoignable.'}
        </p>
      </div>

      {(error || info) && (
        <div
          aria-live="polite"
          className={[
            'mb-4 px-4 py-3 rounded-xl border text-sm',
            error ? 'border-danger bg-danger-soft text-text' : 'border-accent-border bg-accent-soft text-text',
          ].join(' ')}
        >
          {error ?? info}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <section className="glass-fallback bg-glass-bg-soft border border-glass-border-soft rounded-card p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Mode de scan</h2>
          <p className="text-[13px] text-text-dim mb-3">
            Test : données simulées, sans matériel. Réel : mesures Termux:API (localisation activée requise).
            Chaque relevé garde son mode.
          </p>
          <div
            role="group"
            aria-label="Mode de scan"
            className="flex h-11 rounded-xl border border-glass-border-soft overflow-hidden"
          >
            {(['test', 'live'] as const).map((m) => {
              const active = (status?.scan_mode ?? 'test') === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  disabled={switchingMode}
                  onClick={() => {
                    if (!active) switchMode(m);
                  }}
                  className={[
                    'flex-1 px-4 text-sm font-medium transition-colors disabled:cursor-wait',
                    active ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text',
                  ].join(' ')}
                >
                  {m === 'test' ? 'Test' : 'Réel'}
                </button>
              );
            })}
          </div>
        </section>
        <section className="glass-fallback bg-glass-bg-soft border border-glass-border-soft rounded-card p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Serveur iperf3 (optionnel)</h2>
          <p className="text-[13px] text-text-dim mb-3">
            Sans serveur, seuls le Wi-Fi et le ping sont mesurés. Laisse vide pour désactiver.
            {iperf !== null && (
              <>
                {' '}Binaire iperf3 :{' '}
                {iperf.available
                  ? `détecté${iperf.version ? ` (v${iperf.version})` : ''}`
                  : 'non installé — installe-le pour activer les mesures (ex. `pkg install iperf3` sous Termux).'}
              </>
            )}
          </p>
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-text-dim font-medium">Adresse du serveur</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="192.168.1.10"
                value={settings.iperf_server}
                onChange={(e) => setSettings((s) => ({ ...s, iperf_server: e.target.value }))}
                className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-text-dim font-medium">Durée des tests (1–30 s)</span>
              <input
                type="number"
                min={1}
                max={30}
                placeholder="5"
                value={settings.iperf_duration_s}
                onChange={(e) => setSettings((s) => ({ ...s, iperf_duration_s: e.target.value }))}
                className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={saveSettings}
              className="self-start inline-flex items-center h-11 px-5 rounded-[14px] bg-accent text-bg font-medium text-sm hover:opacity-95 disabled:opacity-40 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </section>

        <section className="glass-fallback bg-glass-bg-soft border border-glass-border-soft rounded-card p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Noms et liste noire des BSSID</h2>
          <p className="text-[13px] text-text-dim mb-3">
            Les noms sont globaux et remplacent le BSSID dans l’application. Un BSSID en liste noire est exclu des scans et des analyses, y compris l’historique.
          </p>
            <>
              {mappings.length === 0 ? (
                <p className="text-[13px] text-text-dim mb-2">Aucun BSSID configuré.</p>
              ) : (
                <div className="flex flex-col gap-2 mb-3">
                  {mappings.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2.5 p-2 rounded-xl border border-transparent hover:bg-glass-bg"
                    >
                      <div className="flex-1 min-w-0">
                        {editingRuleId === m.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              aria-label={`Nom de ${m.bssid}`}
                              value={editingRuleName}
                              onChange={(e) => setEditingRuleName(e.target.value)}
                              className="min-w-0 h-8 px-2 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-lg text-[13px] text-text outline-none focus:border-accent"
                            />
                            <button
                              type="button"
                              onClick={() => saveRuleName(m)}
                              className="h-8 px-2 rounded-lg border border-glass-border text-[12px] text-text"
                            >
                              OK
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRuleId(m.id);
                              setEditingRuleName(m.name);
                            }}
                            className="text-left text-[13px] font-medium truncate"
                          >
                            {m.name || 'Renommer'}
                          </button>
                        )}
                        <div className="font-mono text-[12px] text-text-dim">{m.bssid}</div>
                      </div>
                      <button
                        type="button"
                        aria-pressed={m.blacklisted}
                        onClick={() => toggleBlacklist(m)}
                        className={[
                          'shrink-0 h-9 px-3 rounded-[10px] text-[13px] border transition-colors',
                          m.blacklisted
                            ? 'border-danger bg-danger-soft text-danger'
                            : 'border-glass-border text-text-dim hover:text-text',
                        ].join(' ')}
                      >
                        {m.blacklisted ? 'Liste noire' : 'Exclure'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Supprimer ${m.name}`}
                        onClick={() => removeMapping(m.id)}
                        className="shrink-0 h-9 px-3 rounded-[10px] text-[13px] text-text-dim border border-glass-border hover:text-danger transition-colors"
                      >
                        Supprimer
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mapError && <p className="text-danger text-[13px] mb-2">{mapError}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  type="text"
                  aria-label="Nom de la borne"
                  placeholder="Borne salon"
                  value={mapName}
                  onChange={(e) => setMapName(e.target.value)}
                  className="h-11 px-3 bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none focus:border-accent"
                />
                <input
                  type="text"
                  aria-label="Adresse MAC"
                  placeholder="9e:05:d6:96:e8:30"
                  value={mapBssid}
                  onChange={(e) => setMapBssid(e.target.value)}
                  className="h-11 px-3 font-mono bg-[rgba(255,255,255,0.03)] border border-glass-border-soft rounded-xl text-sm text-text outline-none focus:border-accent"
                />
                <label className="sm:col-span-2 flex items-center gap-2 text-[13px] text-text-dim">
                  <input
                    type="checkbox"
                    checked={blacklistNew}
                    onChange={(e) => setBlacklistNew(e.target.checked)}
                    className="w-4 h-4 accent-[#10b981]"
                  />
                  Ajouter directement à la liste noire
                </label>
                <button
                  type="button"
                  onClick={addMapping}
                  className="inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-medium bg-glass-bg border border-glass-border text-text hover:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  Ajouter
                </button>
              </div>
            </>
        </section>

        {plan && (
          <section className="glass-fallback bg-glass-bg-soft border border-glass-border-soft rounded-card p-4 lg:p-5">
            <h2 className="text-sm font-medium mb-1">Export</h2>
            <p className="text-[13px] text-text-dim mb-3">
              Tous les relevés du plan actif, une ligne par réseau observé.
            </p>
            <a
              href={exportCsvUrl(plan.id)}
              download
              className="inline-flex items-center h-11 px-5 rounded-[14px] bg-accent text-bg font-medium text-sm hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Télécharger le CSV
            </a>
          </section>
        )}
      </div>
    </div>
  );
}
