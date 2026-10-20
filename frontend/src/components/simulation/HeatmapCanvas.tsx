import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clamp, gridToRgba } from '../../lib/heatmap';
import type { ColorStop, HeatmapGrid, Point, Surface } from '../../types/wifi';

interface HeatmapCanvasProps {
  surface: Surface;
  grid: HeatmapGrid;
  colorStops: readonly ColorStop[];
  ap: Point;
  /** Direction de l'azimut 0° du diagramme, en degrés (y vers le bas). */
  apRotationDeg: number;
  probe: Point | null;
  onApMove: (p: Point) => void;
  onProbeMove: (p: Point) => void;
}

type DragMode = 'ap' | 'probe' | null;

export function HeatmapCanvas({
  surface,
  grid,
  colorStops,
  ap,
  apRotationDeg,
  probe,
  onApMove,
  onProbeMove,
}: HeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragMode>(null);
  const pendingRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Suit la taille CSS réelle du conteneur (redimensionnement, responsive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Rendu : 1 pixel par cellule sur un canvas hors écran, puis agrandissement
  // lissé (bilinéaire) vers le canvas visible.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(size.width * dpr));
    const ph = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const off = offscreenRef.current ?? document.createElement('canvas');
    offscreenRef.current = off;
    off.width = grid.cols;
    off.height = grid.rows;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const image = offCtx.createImageData(grid.cols, grid.rows);
    image.data.set(gridToRgba(grid, colorStops));
    offCtx.putImageData(image, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(off, 0, 0, pw, ph);
  }, [grid, colorStops, size]);

  // Nettoyage du rAF en attente au démontage.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const toPhysical = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): Point | null => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return {
        x: clamp(((e.clientX - rect.left) / rect.width) * surface.widthM, 0, surface.widthM),
        y: clamp(((e.clientY - rect.top) / rect.height) * surface.heightM, 0, surface.heightM),
      };
    },
    [surface.widthM, surface.heightM],
  );

  const applyPending = useCallback(() => {
    rafRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    if (dragRef.current === 'ap') onApMove(p);
    else if (dragRef.current === 'probe') onProbeMove(p);
  }, [onApMove, onProbeMove]);

  const schedule = useCallback(
    (p: Point) => {
      pendingRef.current = p;
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(applyPending);
    },
    [applyPending],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = toPhysical(e);
    if (!p) return;
    const hitRadiusM = Math.min(surface.widthM, surface.heightM) * 0.06;
    dragRef.current = Math.hypot(p.x - ap.x, p.y - ap.y) <= hitRadiusM ? 'ap' : 'probe';
    e.currentTarget.setPointerCapture(e.pointerId);
    if (dragRef.current === 'probe') onProbeMove(p);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const p = toPhysical(e);
    if (p) schedule(p);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      applyPending();
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const { widthM, heightM } = surface;
  const markerR = Math.min(widthM, heightM) * 0.045;
  const iconScale = markerR / 1.5;
  const rotRad = (apRotationDeg * Math.PI) / 180;
  const vLines = Array.from({ length: Math.max(0, Math.ceil(widthM) - 1) }, (_, i) => i + 1);
  const hLines = Array.from({ length: Math.max(0, Math.ceil(heightM) - 1) }, (_, i) => i + 1);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={`Surface de simulation ${widthM} m par ${heightM} m. Glissez le point d'accès pour le déplacer.`}
      className="relative w-full cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-900"
      style={{ aspectRatio: `${widthM} / ${heightM}` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${widthM} ${heightM}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {widthM <= 50 &&
          vLines.map((x) => (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={heightM} stroke="white" strokeOpacity={0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        {heightM <= 50 &&
          hLines.map((y) => (
            <line key={`h${y}`} x1={0} y1={y} x2={widthM} y2={y} stroke="white" strokeOpacity={0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

        {probe && (
          <>
            <line x1={ap.x} y1={ap.y} x2={probe.x} y2={probe.y} stroke="white" strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            <circle cx={probe.x} cy={probe.y} r={markerR * 0.4} fill="none" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <circle cx={probe.x} cy={probe.y} r={markerR * 0.12} fill="white" />
          </>
        )}

        <g transform={`translate(${ap.x} ${ap.y})`}>
          <line x1={0} y1={0} x2={Math.cos(rotRad) * markerR * 2} y2={Math.sin(rotRad) * markerR * 2} stroke="#38bdf8" strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle r={markerR} fill="#0f172a" fillOpacity={0.9} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <g transform={`scale(${iconScale})`} fill="none" stroke="white" strokeLinecap="round" strokeWidth={0.16}>
            <path d="M -0.283 0.167 A 0.4 0.4 0 0 1 0.283 0.167" />
            <path d="M -0.53 -0.08 A 0.75 0.75 0 0 1 0.53 -0.08" />
            <path d="M -0.778 -0.328 A 1.1 1.1 0 0 1 0.778 -0.328" />
            <circle cx={0} cy={0.45} r={0.13} fill="white" stroke="none" />
          </g>
        </g>
      </svg>
    </div>
  );
}
