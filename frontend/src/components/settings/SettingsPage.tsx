import { useCallback, useEffect, useMemo, useState, type SetStateAction } from 'react';
import {
  getStatus,
  getSettings,
  patchSetting,
  getIperfStatus,
  listBssidRules,
  listSeenBssids,
  createBssidRule,
  updateBssidRule,
  deleteBssidRule,
  type BssidRule,
  type BssidSeen,
  type AppSettings,
  type AppStatus,
} from '../../lib/api';
import { ApiError } from '../../types/api';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useHeatmapColours } from '../../hooks/useHeatmapColours';
import {
  positionToRssi,
  sanitizeHeatmapColours,
  type HeatmapColours,
  type ColourStop,
} from '../../lib/heatmapColours';

const SETTINGS_CATEGORIES = [
  {
    "key": "scan",
    "label": "Mode et serveur",
    "subtitle": "Scan et mesures de débit",
    "words": "scan mode test réel termux iperf3 serveur adresse durée débit mesures"
  },
  {
    "key": "bssid",
    "label": "Points d'accès et BSSID",
    "subtitle": "Noms et liste noire",
    "words": "bssid mac borne ssid liste noire exclusions"
  },
  {
    "key": "colors",
    "label": "Couleurs de heatmap",
    "subtitle": "Dégradé et opacité RSSI",
    "words": "couleur couleurs seuils heatmap opacité rssi"
  }
] as const;
type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['key'];

const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export function SettingsPage() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [iperf, setIperf] = useState<{ available: boolean; version: string | null } | null>(null);
  const [settings, setSettings] = useState<AppSettings>({ iperf_server: '', iperf_duration_s: '', scan_mode: '', heatmap_colours: '' });
  const [switchingMode, setSwitchingMode] = useState(false);
  const [mappings, setMappings] = useState<BssidRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colours: hookColours, save: saveHeatmapColours, reset: resetHeatmapColours } = useHeatmapColours();
  const [colourDraft, setColourDraft] = useState<{ source: HeatmapColours; value: HeatmapColours } | null>(null);
  const heatmapColours = colourDraft?.source === hookColours ? colourDraft.value : hookColours;
  const setHeatmapColours = (next: SetStateAction<HeatmapColours>) => {
    setColourDraft(draft => ({
      source: hookColours,
      value: typeof next === 'function' ? next(draft?.source === hookColours ? draft.value : hookColours) : next,
    }));
  };
  const [heatmapMsg, setHeatmapMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mapName, setMapName] = useState('');
  const [mapNameTouched, setMapNameTouched] = useState(false);
  const [mapBssid, setMapBssid] = useState('');
  const [blacklistNew, setBlacklistNew] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleName, setEditingRuleName] = useState('');
  const [mapError, setMapError] = useState<string | null>(null);
  const [seenBssids, setSeenBssids] = useState<BssidSeen[]>([]);
  const [seenLoading, setSeenLoading] = useState(false);
  const [selectedSeen, setSelectedSeen] = useState<Record<string, boolean>>({});
  const [seenSearch, setSeenSearch] = useState('');
  const [bssidFilter, setBssidFilter] = useState<'all' | 'blacklisted' | 'allowed'>('all');
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [blacklistingSeen, setBlacklistingSeen] = useState(false);
  const [unblacklistingSeen, setUnblacklistingSeen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsCategory>('scan');
  const [settingsSearch, setSettingsSearch] = useState('');
  const matchingCategories = SETTINGS_CATEGORIES.filter((category) =>
    `${category.label} ${category.subtitle} ${category.words}`.toLocaleLowerCase('fr').includes(settingsSearch.trim().toLocaleLowerCase('fr'))
  );

  useApiQuery(getSettings, {
    success: setSettings,
    error: err => setError(err instanceof ApiError ? err.message : 'Impossible de charger les paramètres.'),
    settled: () => setLoading(false),
  });

  useEffect(() => {
    let alive = true;
    void getStatus().then(
      value => { if (alive) setStatus(value); },
      err => { if (alive) setError(err instanceof ApiError ? err.message : 'Impossible de charger le statut.'); },
    );
    void getIperfStatus().then(value => { if (alive) setIperf(value); }, () => {});
    return () => { alive = false; };
  }, []);

  const saveHeatmap = async () => {
    setHeatmapMsg(null);
    const sanitized = sanitizeHeatmapColours(heatmapColours);
    setHeatmapColours(sanitized);
    try {
      await saveHeatmapColours(sanitized);
      setHeatmapMsg({ type: 'ok', text: 'Couleurs de heatmap enregistrées.' });
    } catch (e) {
      setHeatmapMsg({ type: 'err', text: e instanceof ApiError ? e.message : "Erreur lors de l'enregistrement." });
    }
  };

  const resetHeatmap = async () => {
    setHeatmapMsg(null);
    try {
      const res = await resetHeatmapColours();
      setHeatmapColours(res);
      setHeatmapMsg({ type: 'ok', text: 'Couleurs de heatmap réinitialisées.' });
    } catch (e) {
      setHeatmapMsg({ type: 'err', text: e instanceof ApiError ? e.message : "Erreur lors de la réinitialisation." });
    }
  };

  const updateStop = (index: number, patch: Partial<ColourStop>) => {
    setHeatmapColours((prev) => {
      const stops = prev.stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...prev, stops };
    });
  };

  const removeStop = (index: number) => {
    setHeatmapColours((prev) => {
      if (prev.stops.length <= 2) return prev;
      const stops = prev.stops.filter((_, i) => i !== index);
      return { ...prev, stops };
    });
  };

  const addStop = () => {
    setHeatmapColours((prev) => {
      if (prev.stops.length >= 12) return prev;
      const last = prev.stops[prev.stops.length - 1];
      const newStop: ColourStop = {
        position: Math.min(1, last.position + 0.1),
        color: '#10b981',
        opacity: 1,
      };
      return { ...prev, stops: [...prev.stops, newStop] };
    });
  };

  useApiQuery(listBssidRules, {
    success: setMappings,
    error: err => setMapError(err instanceof ApiError ? err.message : 'Impossible de charger les règles BSSID.'),
  });

  useApiQuery(listSeenBssids, {
    start: () => setSeenLoading(true),
    success: rows => {
      setSeenBssids(rows);
      setSelectedSeen(prev => Object.fromEntries(
        rows.map(item => [item.bssid, prev[item.bssid] ?? item.blacklisted]),
      ));
    },
    error: err => setMapError(err instanceof ApiError ? err.message : 'Impossible de charger les BSSID capturés.'),
    settled: () => setSeenLoading(false),
  });

  const matchesBssidFilter = (blacklisted: boolean) =>
    bssidFilter === 'all' ||
    (bssidFilter === 'blacklisted' ? blacklisted : !blacklisted);

  const filteredSeen = seenBssids.filter((item) =>
    matchesBssidFilter(item.blacklisted) &&
    `${item.bssid} ${item.ssid ?? ''} ${item.name ?? ''}`
      .toLocaleLowerCase('fr')
      .includes(seenSearch.trim().toLocaleLowerCase('fr'))
  );
  const filteredMappings = mappings.filter((m) => matchesBssidFilter(m.blacklisted));
  const selectedSeenItems = seenBssids.filter((item) => selectedSeen[item.bssid]);
  const selectedToBlacklist = selectedSeenItems.filter((item) => !item.blacklisted);
  const selectedToUnblacklist = selectedSeenItems.filter((item) => item.blacklisted && item.rule_id);

  const ssidByBssid = useMemo(() => {
    const index = new Map<string, string>();
    for (const item of seenBssids) {
      if (item.ssid) index.set(item.bssid.toLowerCase(), item.ssid);
    }
    return index;
  }, [seenBssids]);
  const matchedMapSsid = ssidByBssid.get(mapBssid.trim().toLowerCase()) ?? '';
  const displayedMapName = mapNameTouched ? mapName : matchedMapSsid;

  const toggleSeenSelection = useCallback((bssid: string) => {
    setSelectedSeen((prev) => ({ ...prev, [bssid]: !prev[bssid] }));
  }, []);

  const addSelectedToBlacklist = useCallback(async () => {
    const toAdd = seenBssids.filter((s) => selectedSeen[s.bssid] && !s.blacklisted);
    if (toAdd.length === 0) {
      setMapError('Aucun BSSID sélectionné à ajouter à la liste noire.');
      return;
    }
    setInfo(null);
    setBlacklistingSeen(true);
    setMapError(null);
    try {
      await Promise.all(
        toAdd.map(async (item) => {
          const defaultName = item.name || item.ssid || '';
          if (item.rule_id) {
            return updateBssidRule(item.rule_id, { name: defaultName, blacklisted: true });
          }
          return createBssidRule({ bssid: item.bssid, name: defaultName, blacklisted: true });
        }),
      );
      setSelectedSeen((prev) => {
        const next = { ...prev };
        for (const item of toAdd) next[item.bssid] = true;
        return next;
      });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? "Impossible d'ajouter à la liste noire.");
    } finally {
      setBlacklistingSeen(false);
    }
  }, [seenBssids, selectedSeen]);

  const removeSelectedFromBlacklist = useCallback(async () => {
    const toRemove = seenBssids.filter(
      (s) => selectedSeen[s.bssid] && s.blacklisted && s.rule_id
    );
    if (toRemove.length === 0) {
      setMapError('Aucun BSSID sélectionné à retirer de la liste noire.');
      return;
    }
    setInfo(null);
    setUnblacklistingSeen(true);
    setMapError(null);
    try {
      const results = await Promise.all(
        toRemove.map((item) => updateBssidRule(item.rule_id as string, { blacklisted: false }))
      );
      setSelectedSeen((prev) => {
        const next = { ...prev };
        for (const item of toRemove) next[item.bssid] = false;
        return next;
      });
      setInfo(
        `${results.length} BSSID retiré${results.length > 1 ? 's' : ''} de la liste noire.`
      );
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de retirer de la liste noire.');
    } finally {
      setUnblacklistingSeen(false);
    }
  }, [seenBssids, selectedSeen]);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const duration = settings.iperf_duration_s.trim() || '5';
      await patchSetting('iperf_server', settings.iperf_server.trim());
      await patchSetting('iperf_duration_s', duration);
      setInfo('Réglages enregistrés.');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible d’enregistrer les réglages.');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const addMapping = useCallback(async () => {
    const name = displayedMapName.trim();
    const bssid = mapBssid.trim().toLowerCase();
    if (!BSSID_RE.test(bssid)) {
      setMapError('Adresse MAC invalide (ex. 9e:05:d6:96:e8:30).');
      return;
    }
    setMapError(null);
    try {
      await createBssidRule({ name, bssid, blacklisted: blacklistNew });
      setMapName('');
      setMapNameTouched(false);
      setMapBssid('');
      setBlacklistNew(false);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible d’ajouter cette borne.');
    }
  }, [displayedMapName, mapBssid, blacklistNew]);

  const removeMapping = useCallback(async (id: string) => {
    try {
      setBusyRuleId(id);
      await deleteBssidRule(id);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de supprimer cette borne.');
    } finally { setBusyRuleId(null); }
  }, []);

  const toggleBlacklist = useCallback(async (rule: BssidRule) => {
    try {
      await updateBssidRule(rule.id, { blacklisted: !rule.blacklisted });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMapError(apiErr?.message ?? 'Impossible de modifier la liste noire.');
    }
  }, []);

  const saveRuleName = useCallback(async (rule: BssidRule) => {
    try {
      await updateBssidRule(rule.id, { name: editingRuleName.trim() });
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
      setInfo(mode === 'live' ? 'Mode réel activé : les scans utilisent Termux:API.' : 'Mode test activé : les scans utilisent les données simulées.');
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setError(apiErr?.message ?? 'Impossible de changer de mode.');
    } finally {
      setSwitchingMode(false);
    }
  }, []);

  const scanMode = settings.scan_mode || status?.scan_mode || 'test';

  if (loading) {
    return <div className="fixed inset-0 bg-bg" />;
  }

  return (
    <div className="page-shell">
      <div className="mb-6">
        <h1 className="page-title mb-2">Paramètres</h1>
        <p className="text-text-dim text-sm">
          {status
            ? `Mode ${scanMode === 'test' ? 'test (données simulées)' : 'réel (Termux:API)'} · ${status.platform} · Node ${status.node}`
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

      <div className="grid gap-5 lg:grid-cols-[245px_minmax(0,1fr)] lg:items-start">
        <aside className="surface p-3 lg:sticky lg:top-24" aria-label="Catégories des paramètres">
          <label className="mb-3 block">
            <span className="mb-1.5 block text-xs font-medium text-text-dim">Rechercher un réglage</span>
            <input type="search" value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder="Mode, serveur, BSSID…" aria-label="Rechercher un réglage"
              className="h-11 w-full rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 text-sm text-text outline-none focus:border-accent" />
          </label>
          <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible" aria-label="Sections des paramètres">
            {matchingCategories.map((category) => (
              <button key={category.key} type="button" aria-current={activeSection === category.key ? 'true' : undefined}
                onClick={() => setActiveSection(category.key)}
                className={[
                  'min-h-12 shrink-0 rounded-xl border px-3 py-2 text-left transition-colors lg:w-full',
                  activeSection === category.key
                    ? 'border-accent-border bg-accent-soft text-accent'
                    : 'border-glass-border-soft bg-glass-bg-soft text-text hover:bg-white/5',
                ].join(' ')}>
                <span className="block text-sm font-medium">{category.label}</span>
                <span className="mt-0.5 hidden text-xs text-text-dim lg:block">{category.subtitle}</span>
              </button>
            ))}
            {matchingCategories.length === 0 && <p className="px-2 py-3 text-sm text-text-dim">Aucun réglage trouvé.</p>}
          </nav>
        </aside>
        <div className="min-w-0 flex flex-col gap-4">
        <section style={{ display: activeSection === 'scan' ? undefined : 'none' }} className="surface p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Mode et serveur</h2>
          <p className="text-[13px] text-text-dim mb-4">
            Choisis le mode de scan et, si besoin, un serveur iperf3 pour les mesures de débit.
          </p>
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="text-[13px] font-medium mb-1">Mode de scan</h3>
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
                  const active = scanMode === m;
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
            </div>
            <div className="border-t border-glass-border-soft pt-4">
              <h3 className="text-[13px] font-medium mb-1">Serveur iperf3 (optionnel)</h3>
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
                    className="h-11 px-3 bg-glass-bg-soft border border-glass-border rounded-xl text-sm text-text outline-none focus:border-accent"
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
                    className="h-11 px-3 bg-glass-bg-soft border border-glass-border rounded-xl text-sm text-text outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveSettings}
                  className="self-start inline-flex items-center h-11 px-5 rounded-[14px] bg-accent text-bg font-medium text-sm hover:opacity-95 disabled:opacity-40 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer le serveur'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: activeSection === 'bssid' ? undefined : 'none' }} className="surface p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Noms et liste noire des BSSID</h2>
          <p className="text-[13px] text-text-dim mb-3">
            Les noms sont globaux et remplacent le BSSID dans l’application. Un BSSID en liste noire est exclu des scans et des analyses, y compris l’historique.
          </p>
          <div role="group" aria-label="Filtrer les BSSID par liste noire" className="mb-3 flex flex-wrap gap-1 rounded-xl border border-glass-border-soft bg-glass-bg-soft p-1">
            {([
              { value: 'all', label: 'Tous' },
              { value: 'blacklisted', label: 'Liste noire' },
              { value: 'allowed', label: 'Non blacklistés' },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={bssidFilter === option.value}
                onClick={() => setBssidFilter(option.value)}
                className={[
                  'min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors',
                  bssidFilter === option.value
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-dim hover:bg-white/5 hover:text-text',
                ].join(' ')}
              >
                {option.label}
              </button>
            ))}
          </div>
          {mapError && <p role="alert" className="mb-3 text-[13px] text-danger">{mapError}</p>}
              <>
                <details open className="mb-4 rounded-xl border border-glass-border-soft p-3">
                  <summary className="cursor-pointer text-[13px] font-medium">Radios détectées <span className="text-text-dim">({filteredSeen.length === seenBssids.length ? seenBssids.length : `${filteredSeen.length}/${seenBssids.length}`})</span></summary>
                <div className="mt-3">
                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-[13px] font-medium">Sélectionner les radios</h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={blacklistingSeen || unblacklistingSeen || seenLoading || selectedToBlacklist.length === 0}
                        onClick={addSelectedToBlacklist}
                        className="inline-flex items-center h-9 px-3 rounded-lg text-[13px] bg-glass-bg-soft border border-glass-border-soft text-text backdrop-blur-ui hover:border-glass-border hover:bg-glass-bg disabled:opacity-40"
                      >
                        {blacklistingSeen ? 'Ajout…' : 'Ajouter à la liste noire'}
                      </button>
                      <button
                        type="button"
                        disabled={unblacklistingSeen || blacklistingSeen || seenLoading || selectedToUnblacklist.length === 0}
                        onClick={removeSelectedFromBlacklist}
                        className="inline-flex items-center h-9 px-3 rounded-lg text-[13px] border border-accent-border bg-accent-soft text-accent hover:bg-accent-soft/80 disabled:opacity-40"
                      >
                        {unblacklistingSeen ? 'Retrait…' : 'Retirer de la liste noire'}
                      </button>
                    </div>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2"><input type="search" value={seenSearch} onChange={(e) => setSeenSearch(e.target.value)} placeholder="Rechercher SSID ou BSSID" aria-label="Rechercher une radio détectée" className="field min-w-40 flex-1"/><button type="button" className="btn-secondary min-h-11 px-3" disabled={filteredSeen.length === 0} onClick={() => { const all = filteredSeen.every((item) => selectedSeen[item.bssid]); setSelectedSeen((prev) => { const next={...prev}; filteredSeen.forEach((item) => { next[item.bssid]=!all; }); return next; }); }}>{filteredSeen.every((item) => selectedSeen[item.bssid]) ? 'Désélectionner les résultats' : 'Sélectionner les résultats'}</button></div>
                  {seenLoading ? (
                    <p className="text-[13px] text-text-dim">Chargement…</p>
                  ) : filteredSeen.length === 0 ? (
                    <p className="text-[13px] text-text-dim">
                      {seenBssids.length === 0
                        ? 'Aucun BSSID capturé trouvé.'
                        : 'Aucune radio ne correspond à ce filtre.'}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-64 overflow-auto rounded-xl border border-glass-border-soft">
                      {filteredSeen.map((s) => (
                        <label
                          key={s.bssid}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-glass-bg cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={!!selectedSeen[s.bssid]}
                            onChange={() => toggleSeenSelection(s.bssid)}
                            className="w-4 h-4 accent-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[12px]">{s.bssid}</span>
                              {s.blacklisted && <span className="text-[11px] text-danger">liste noire</span>}
                            </div>
                            {s.ssid && <div className="text-[12px] text-text-dim truncate">{s.ssid}</div>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div></details>
              <details open className="mb-3 rounded-xl border border-glass-border-soft p-3"><summary className="cursor-pointer text-[13px] font-medium">Règles configurées <span className="text-text-dim">({filteredMappings.length === mappings.length ? mappings.length : `${filteredMappings.length}/${mappings.length}`})</span></summary><div className="mt-3">
              {filteredMappings.length === 0 ? (
                <p className="text-[13px] text-text-dim mb-2">
                  {mappings.length === 0
                    ? 'Aucun BSSID configuré.'
                    : 'Aucune règle ne correspond à ce filtre.'}
                </p>
              ) : (
                <div className="flex flex-col gap-2 mb-3">
                  {filteredMappings.map((m) => {
                    const ruleSsid = ssidByBssid.get(m.bssid.toLowerCase()) ?? '';
                    const displayName = m.name || ruleSsid;
                    return (
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
                              placeholder={m.bssid}
                              value={editingRuleName}
                              onChange={(e) => setEditingRuleName(e.target.value)}
                              className="min-w-0 h-8 px-2 bg-glass-bg-soft border border-glass-border rounded-lg text-[13px] text-text outline-none focus:border-accent"
                            />
                            <button
                              type="button"
                              onClick={() => saveRuleName(m)}
                              className="h-8 px-2 rounded-lg border border-glass-border-soft bg-glass-bg-soft text-[12px] text-text backdrop-blur-ui hover:border-glass-border hover:bg-glass-bg"
                            >
                              OK
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRuleId(m.id);
                              setEditingRuleName(displayName);
                            }}
                            className="text-left text-[13px] font-medium truncate"
                          >
                            {displayName || <span className="font-mono text-[12px]">{m.bssid}</span>}
                          </button>
                        )}
                        {displayName && <div className="font-mono text-[12px] text-text-dim">{m.bssid}</div>}
                      </div>
                      <button
                        type="button"
                        aria-pressed={m.blacklisted}
                        onClick={() => toggleBlacklist(m)}
                        className={[
                          'shrink-0 h-9 px-3 rounded-[10px] text-[13px] border transition-colors whitespace-nowrap',
                          m.blacklisted
                            ? 'border-danger bg-danger-soft text-danger'
                            : 'border-glass-border text-text-dim hover:text-text',
                        ].join(' ')}
                      >
                        {m.blacklisted ? 'Retirer de la liste noire' : 'Exclure'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Supprimer ${m.name || m.bssid}`}
                        onClick={() => { if (window.confirm(`Supprimer la règle de ${m.name || m.bssid} ?`)) void removeMapping(m.id); }}
                        disabled={busyRuleId === m.id}
                        className="shrink-0 h-9 px-3 rounded-[10px] text-[13px] border border-danger/30 bg-danger-soft text-danger hover:border-danger/60 transition-colors"
                      >
                        {busyRuleId === m.id ? 'Suppression…' : 'Supprimer'}
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}
                <div className="border-t border-glass-border-soft pt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-medium text-text-dim">Nom d’affichage</span>
                  <input
                    type="text"
                    aria-label="Nom d’affichage"
                    placeholder="Aucun SSID détecté"
                    value={displayedMapName}
                    onChange={(e) => {
                      setMapName(e.target.value);
                      setMapNameTouched(true);
                    }}
                    className="h-11 px-3 bg-glass-bg-soft border border-glass-border rounded-xl text-sm text-text outline-none focus:border-accent"
                  />
                  <span className="text-[11px] leading-relaxed text-text-dim">
                    {matchedMapSsid
                      ? 'SSID détecté automatiquement, modifiable.'
                      : 'Aucun SSID détecté : le BSSID sera affiché à la place.'}
                  </span>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-medium text-text-dim">BSSID (adresse MAC)</span>
                  <input
                    type="text"
                    aria-label="BSSID (adresse MAC)"
                    placeholder="9e:05:d6:96:e8:30"
                    value={mapBssid}
                    onChange={(e) => setMapBssid(e.target.value)}
                    className="h-11 px-3 font-mono bg-glass-bg-soft border border-glass-border rounded-xl text-sm text-text outline-none focus:border-accent"
                  />
                  <span className="text-[11px] leading-relaxed text-text-dim">Toujours au format MAC.</span>
                </label>
                <label className="sm:col-span-2 flex items-center gap-2 text-[13px] text-text-dim">
                  <input
                    type="checkbox"
                    checked={blacklistNew}
                    onChange={(e) => setBlacklistNew(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  Ajouter directement à la liste noire
                </label>
                <button
                  type="button"
                  onClick={addMapping}
                  className="sm:col-span-2 sm:justify-self-start inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-medium bg-glass-bg-soft border border-glass-border-soft text-text backdrop-blur-ui hover:border-glass-border hover:bg-glass-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  Ajouter
                </button>
              </div></div></details>
            </>
        </section>

        <section style={{ display: activeSection === 'colors' ? undefined : 'none' }} className="surface p-4 lg:p-5">
          <h2 className="text-sm font-medium mb-1">Couleurs de la heatmap</h2>
          <p className="text-[13px] text-text-dim mb-3">
            Personnaliser le dégradé RSSI utilisé sur la carte.
          </p>
          <div
            className="h-3 rounded-full border border-white/10 mb-3"
            style={{
              backgroundImage: `linear-gradient(to right, ${heatmapColours.stops
                .map((s) => s.color)
                .join(', ')})`,
            }}
            aria-hidden
          />
          <div className="space-y-2 mb-3">
            {heatmapColours.stops.map((stop, idx) => {
              const rssi = positionToRssi(stop.position);
              return (
                <div key={idx} className="grid grid-cols-3 gap-2 items-center rounded-item border border-glass-border-soft p-3 sm:grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)_minmax(0,2fr)_auto]">
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label={`Position du seuil ${idx + 1}`}
                    value={stop.position}
                    onChange={(e) => updateStop(idx, { position: Number(e.target.value) })}
                    className="min-w-0 w-full h-10 px-2 bg-glass-bg-soft border border-glass-border rounded-lg text-sm text-text outline-none"
                  />
                  <input
                    type="color"
                    aria-label={`Couleur du seuil ${idx + 1}`}
                    value={stop.color}
                    onChange={(e) => updateStop(idx, { color: e.target.value })}
                    className="h-10 w-full bg-transparent border border-glass-border rounded-lg"
                  />
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    aria-label={`Opacité du seuil ${idx + 1}`}
                    value={stop.opacity}
                    onChange={(e) => updateStop(idx, { opacity: Number(e.target.value) })}
                    className="min-w-0 w-full h-10 px-2 bg-glass-bg-soft border border-glass-border rounded-lg text-sm text-text outline-none"
                  />
                  <div className="col-span-2 text-xs text-text-dim font-mono sm:col-span-1">
                    {Math.round(stop.position * 100)} % signal, environ {Math.round(rssi)} dBm
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStop(idx)}
                    disabled={heatmapColours.stops.length <= 2}
                    className="h-9 px-3 rounded-lg text-[13px] border border-danger/30 bg-danger-soft text-danger hover:border-danger/60 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Supprimer
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              type="button"
              onClick={addStop}
              disabled={heatmapColours.stops.length >= 12}
              className="inline-flex items-center h-9 px-3 rounded-lg text-[13px] bg-glass-bg-soft border border-glass-border-soft text-text backdrop-blur-ui hover:border-glass-border hover:bg-glass-bg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Ajouter un stop
            </button>
            <button
              type="button"
              onClick={resetHeatmap}
              className="inline-flex items-center h-9 px-3 rounded-lg text-[13px] bg-glass-bg-soft border border-glass-border-soft text-text backdrop-blur-ui hover:border-glass-border hover:bg-glass-bg"
            >
              Réinitialiser
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
            <label className="flex flex-col gap-1 text-[13px] text-text-dim">
              Opacité au plus fort
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={heatmapColours.opacityStrongest}
                onChange={(e) => setHeatmapColours((p) => ({ ...p, opacityStrongest: Number(e.target.value) }))}
                className="min-w-0 w-full h-10 px-2 bg-glass-bg-soft border border-glass-border rounded-lg text-sm text-text outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-text-dim">
              Opacité au plus faible
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={heatmapColours.opacityWeakest}
                onChange={(e) => setHeatmapColours((p) => ({ ...p, opacityWeakest: Number(e.target.value) }))}
                className="min-w-0 w-full h-10 px-2 bg-glass-bg-soft border border-glass-border rounded-lg text-sm text-text outline-none"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveHeatmap}
              className="inline-flex items-center h-10 px-4 rounded-xl bg-accent text-bg font-medium text-sm hover:opacity-95"
            >
              Enregistrer
            </button>
            {heatmapMsg && (
              <span className={heatmapMsg.type === 'ok' ? 'text-accent text-[13px]' : 'text-danger text-[13px]'}>
                {heatmapMsg.text}
              </span>
            )}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
