import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown, Radio, Search } from 'lucide-react';

/**
 * Option d'un {@link Combobox}.
 *
 * `label` est le texte affiché. `searchText` permet d'élargir la recherche
 * (SSID, BSSID, alias…) sans polluer le libellé affiché.
 */
export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
}

export interface ComboboxProps {
  /** Libellé affiché au-dessus du champ (optionnel). */
  label?: string;
  /** Valeur sélectionnée (identifiant d'option, `''` autorisé). */
  value: string;
  /** Callback de sélection, reçoit la `value` de l'option choisie. */
  onChange: (value: string) => void;
  /** Options proposées dans le menu. */
  options: ComboboxOption[];
  /** Icône du déclencheur (radio par défaut). */
  icon?: ReactNode;
  /** Placeholder du champ de recherche. */
  searchPlaceholder?: string;
  /** Message affiché quand la recherche ne retourne rien. */
  emptyMessage?: string;
  /** Classe additionnelle appliquée au conteneur racine. */
  className?: string;
}

/**
 * Sélecteur déroulant accessible avec recherche instantanée.
 *
 * - Déclencheur : bouton affichant l'icône, la valeur et un chevron.
 * - Menu flottant sous le champ : barre de recherche + liste défilante
 *   (max ~300px) avec coche verte sur l'option sélectionnée.
 * - Fermeture au clic extérieur, à Échap ou après sélection.
 * - Navigation clavier : ↑/↓ pour parcourir, Entrée pour choisir.
 * - Recherche insensible à la casse sur `label` et `searchText`.
 * - Palette sombre de l'application (aucun menu natif).
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  icon,
  searchPlaceholder = 'Rechercher…',
  emptyMessage = 'Aucun résultat.',
  className = '',
}: ComboboxProps) {
  const uid = useId();
  const listId = `${uid}-listbox`;
  const labelId = `${uid}-label`;
  const valueId = `${uid}-value`;
  const optionId = (index: number) => `${uid}-option-${index}`;

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) =>
      `${option.label} ${option.searchText ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [options, normalizedQuery]);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  const openMenu = () => {
    setQuery('');
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const selectOption = (option: ComboboxOption) => {
    onChange(option.value);
    closeMenu();
  };

  // Focus la recherche dès l'ouverture du menu.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Fermeture au clic (ou tap) en dehors du composant.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  // Garde l'option active visible dans la liste défilante.
  useEffect(() => {
    if (!open || !filtered.length) return;
    const active = rootRef.current?.querySelector<HTMLElement>(
      `[data-combobox-index="${activeIndex}"]`
    );
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, filtered.length]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) =>
          filtered.length ? Math.min(index + 1, filtered.length - 1) : 0
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => (filtered.length ? Math.max(index - 1, 0) : 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = filtered[activeIndex];
        if (option) selectOption(option);
        break;
      }
      case 'Escape':
        event.preventDefault();
        closeMenu();
        break;
      case 'Tab':
        // Laisse le focus sortir naturellement, mais referme le menu.
        setOpen(false);
        setQuery('');
        break;
      default:
        break;
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
    }
  };

  const displayedLabel = selectedOption?.label ?? '—';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && (
        <span id={labelId} className="mb-1 block text-xs text-text-dim">
          {label}
        </span>
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-glass-border-soft bg-glass-bg-soft px-3 text-left text-sm text-text transition-colors duration-ui ease-ui hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <span className="shrink-0 text-text-dim" aria-hidden>
          {icon ?? <Radio size={16} strokeWidth={1.75} />}
        </span>
        <span id={valueId} className="min-w-0 flex-1 truncate">
          {displayedLabel}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden
          className={`shrink-0 text-text-dim transition-transform duration-ui ease-ui ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-glass-border bg-[#111923] shadow-glass">
          <div className="relative border-b border-glass-border-soft">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
            />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                filtered.length ? optionId(activeIndex) : undefined
              }
              aria-label={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              className="h-11 w-full bg-transparent pl-9 pr-3 text-sm text-text outline-none placeholder:text-text-dim"
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-[300px] overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li
                role="status"
                className="px-3 py-4 text-center text-sm text-text-dim"
              >
                {emptyMessage}
              </li>
            ) : (
              filtered.map((option, index) => {
                const selected = option.value === value;
                const active = index === activeIndex;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    data-combobox-index={index}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={[
                      'flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm transition-colors',
                      selected
                        ? 'bg-accent-soft text-text'
                        : active
                          ? 'bg-white/5 text-text'
                          : 'text-text',
                    ].join(' ')}
                  >
                    <span
                      className={`shrink-0 ${
                        selected ? 'text-accent' : 'text-text-dim'
                      }`}
                      aria-hidden
                    >
                      <Radio size={15} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {selected && (
                      <Check
                        size={16}
                        strokeWidth={2}
                        className="shrink-0 text-accent"
                        aria-hidden
                      />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}