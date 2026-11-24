import { useId, useMemo, useState } from 'react';
import {
  channelDomain,
  type ChannelBand,
  type ChannelNetwork,
} from '../../lib/channelAnalysis';

const WIDTH = 920;
const HEIGHT = 420;
const MARGIN = { top: 26, right: 20, bottom: 48, left: 58 };
const RSSI_MIN = -100;
const RSSI_MAX = -20;
const Y_TICKS = [-100, -90, -80, -70, -60, -50, -40, -30, -20];

type Props = {
  band: ChannelBand;
  networks: ChannelNetwork[];
  colours: ReadonlyMap<string, string>;
  selectedBssid: string | null;
  onSelect: (bssid: string | null) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function networkLabel(network: ChannelNetwork): string {
  if (network.ssid) return network.ssid;
  return network.hidden ? 'Réseau masqué' : 'SSID inconnu';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function curvePath(
  network: ChannelNetwork,
  x: (channel: number) => number,
  y: (rssi: number) => number,
): string {
  const half = Math.max(network.widthMhz / 10, 0.5);
  const center = network.centerChannel;
  const left = center - half;
  const right = center + half;
  const peak = y(clamp(network.rssi, RSSI_MIN, RSSI_MAX));
  const base = y(RSSI_MIN);
  return [
    `M ${x(left)} ${base}`,
    `C ${x(left + half * 0.45)} ${base}, ${x(center - half * 0.45)} ${peak}, ${x(center)} ${peak}`,
    `C ${x(center + half * 0.45)} ${peak}, ${x(right - half * 0.45)} ${base}, ${x(right)} ${base}`,
    'Z',
  ].join(' ');
}

export function ChannelChart({
  band,
  networks,
  colours,
  selectedBssid,
  onSelect,
}: Props) {
  const rawId = useId();
  const clipId = `channel-plot-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [hoveredBssid, setHoveredBssid] = useState<string | null>(null);

  const domain = useMemo(() => channelDomain(band, networks), [band, networks]);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const span = Math.max(domain.max - domain.min, 1);

  const x = (channel: number) =>
    MARGIN.left + ((channel - domain.min) / span) * plotWidth;
  const y = (rssi: number) =>
    MARGIN.top + ((RSSI_MAX - rssi) / (RSSI_MAX - RSSI_MIN)) * plotHeight;

  const focusBssid = hoveredBssid ?? selectedBssid;
  const hovered = hoveredBssid
    ? networks.find((network) => network.bssid === hoveredBssid) ?? null
    : null;
  const selected = selectedBssid
    ? networks.find((network) => network.bssid === selectedBssid) ?? null
    : null;

  const sorted = useMemo(
    () =>
      [...networks].sort((a, b) => {
        if (selectedBssid === a.bssid) return 1;
        if (selectedBssid === b.bssid) return -1;
        return a.rssi - b.rssi;
      }),
    [networks, selectedBssid],
  );

  const tooltip = (() => {
    if (!hovered) return null;
    const peakX = x(hovered.centerChannel);
    const peakY = y(clamp(hovered.rssi, RSSI_MIN, RSSI_MAX));
    const boxWidth = 218;
    const boxHeight = 66;
    return {
      x: clamp(peakX - boxWidth / 2, MARGIN.left + 4, WIDTH - MARGIN.right - boxWidth - 4),
      y: clamp(peakY - boxHeight - 12, MARGIN.top + 4, HEIGHT - MARGIN.bottom - boxHeight),
      width: boxWidth,
      height: boxHeight,
    };
  })();

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Graphique des canaux ${band === '2.4' ? '2,4' : '5'} GHz, puissance RSSI de ${RSSI_MIN} à ${RSSI_MAX} dBm`}
      className="block h-auto w-full min-w-[620px]"
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotWidth}
            height={plotHeight}
          />
        </clipPath>
      </defs>

      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={plotWidth}
        height={plotHeight}
        fill="rgba(255,255,255,0.012)"
        stroke="rgba(255,255,255,0.08)"
        rx={8}
      />

      {Y_TICKS.map((rssi) => (
        <g key={rssi}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(rssi)}
            y2={y(rssi)}
            stroke={rssi === RSSI_MIN || rssi === RSSI_MAX ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'}
          />
          <text
            x={MARGIN.left - 9}
            y={y(rssi) + 4}
            textAnchor="end"
            fontSize={11}
            fill="#8b98a5"
            fontFamily="var(--font-mono)"
          >
            {rssi}
          </text>
        </g>
      ))}

      {domain.ticks.map((channel) => (
        <g key={channel}>
          <line
            x1={x(channel)}
            x2={x(channel)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotHeight}
            stroke="rgba(255,255,255,0.045)"
          />
          <text
            x={x(channel)}
            y={MARGIN.top + plotHeight + 19}
            textAnchor="middle"
            fontSize={11}
            fill="#8b98a5"
            fontFamily="var(--font-mono)"
          >
            {channel}
          </text>
        </g>
      ))}

      <text
        x={14}
        y={MARGIN.top + plotHeight / 2}
        textAnchor="middle"
        fontSize={11}
        fill="#8b98a5"
        transform={`rotate(-90 14 ${MARGIN.top + plotHeight / 2})`}
      >
        Puissance (dBm)
      </text>
      <text
        x={MARGIN.left + plotWidth / 2}
        y={HEIGHT - 5}
        textAnchor="middle"
        fontSize={11}
        fill="#8b98a5"
      >
        Canal
      </text>

      <g clipPath={`url(#${clipId})`}>
        {sorted.map((network) => {
          const colour = colours.get(network.bssid) ?? '#10b981';
          const active = focusBssid === network.bssid;
          const dimmed = focusBssid !== null && !active;
          const path = curvePath(network, x, y);
          const label = networkLabel(network);
          return (
            <g
              key={network.bssid}
              role="button"
              tabIndex={0}
              aria-label={`${label}, BSSID ${network.bssid}, canal ${network.channel}, ${network.rssi} dBm`}
              onPointerEnter={() => setHoveredBssid(network.bssid)}
              onPointerLeave={() => setHoveredBssid(null)}
              onFocus={() => setHoveredBssid(network.bssid)}
              onBlur={() => setHoveredBssid(null)}
              onClick={() =>
                onSelect(selectedBssid === network.bssid ? null : network.bssid)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(selectedBssid === network.bssid ? null : network.bssid);
                }
              }}
              className="cursor-pointer focus-visible:outline-none"
            >
              <title>
                {label} · {network.bssid} · canal {network.channel} · {network.rssi} dBm
              </title>
              <path
                d={path}
                fill={colour}
                fillOpacity={dimmed ? 0.012 : active ? 0.14 : 0.055}
                stroke={colour}
                strokeOpacity={dimmed ? 0.18 : active ? 1 : 0.9}
                strokeWidth={active ? 2.6 : 1.6}
                strokeDasharray={network.widthEstimated ? '6 4' : undefined}
                strokeLinejoin="round"
              />
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                pointerEvents="stroke"
              />
            </g>
          );
        })}
      </g>

      {selected && !hovered && (
        <SelectedTag
          network={selected}
          colour={colours.get(selected.bssid) ?? '#10b981'}
          x={x(selected.centerChannel)}
          y={y(clamp(selected.rssi, RSSI_MIN, RSSI_MAX))}
        />
      )}

      {hovered && tooltip && (
        <g pointerEvents="none">
          <rect
            x={tooltip.x}
            y={tooltip.y}
            width={tooltip.width}
            height={tooltip.height}
            rx={8}
            fill="#0b1119"
            stroke="rgba(255,255,255,0.14)"
          />
          <text
            x={tooltip.x + 10}
            y={tooltip.y + 18}
            fontSize={12}
            fill="#e6edf3"
            fontWeight={500}
          >
            {truncate(networkLabel(hovered), 27)}
          </text>
          <text
            x={tooltip.x + 10}
            y={tooltip.y + 35}
            fontSize={10}
            fill="#8b98a5"
            fontFamily="var(--font-mono)"
          >
            {hovered.bssid}
          </text>
          <text
            x={tooltip.x + 10}
            y={tooltip.y + 52}
            fontSize={10}
            fill="#8b98a5"
            fontFamily="var(--font-mono)"
          >
            canal {hovered.channel} · {hovered.rssi} dBm · {hovered.widthEstimated ? '~' : ''}
            {hovered.widthMhz} MHz
          </text>
        </g>
      )}
    </svg>
  );
}

/** Étiquette persistante du réseau sélectionné, au-dessus de son pic. */
function SelectedTag({
  network,
  colour,
  x,
  y,
}: {
  network: ChannelNetwork;
  colour: string;
  x: number;
  y: number;
}) {
  const label = truncate(`${networkLabel(network)} ${network.rssi} dBm`, 26);
  const width = Math.round(label.length * 6.6 + 20);
  const height = 26;
  const left = clamp(x - width / 2, MARGIN.left + 4, WIDTH - MARGIN.right - width - 4);
  const top = clamp(y - height - 12, MARGIN.top + 4, HEIGHT - MARGIN.bottom - height);

  return (
    <g pointerEvents="none">
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={8}
        fill="#0b1119"
        stroke={colour}
        strokeOpacity={0.5}
      />
      <text
        x={left + 10}
        y={top + 17}
        fontSize={12}
        fill={colour}
        fontFamily="var(--font-mono)"
      >
        {label}
      </text>
    </g>
  );
}
