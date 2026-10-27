import { useState } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  Marker,
  Polygon,
  Polyline,
  Tooltip,
  useMapEvents,
} from 'react-leaflet';
import type { LeafletMouseEvent } from 'leaflet';
import { clampCoord, dataToLatLng, latlngToData } from '../../lib/coords';
import type { NormalizedCoord } from '../../lib/coords';
import type { PlanPolygon } from '../../types/polygon';

const POLYGON_COLOR = '#38bdf8';
const POLYGON_SELECTED_COLOR = '#22d3ee';
const VERTEX_COLOR = '#38bdf8';
const FIRST_VERTEX_COLOR = '#fbbf24';
const OUTLINE_COLOR = '#0b0f14';

const EDIT_VERTEX_ICON = L.divIcon({
  className: 'polygon-vertex-marker',
  html: '<span></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export interface PolygonEditingState {
  polygonId: string;
  vertices: NormalizedCoord[];
}

interface PolygonEditorLayerProps {
  width: number;
  height: number;
  /** Mode dessin actif : les clics sur le plan ajoutent des sommets. */
  drawing: boolean;
  /** Sommets de la zone en cours de tracé. */
  activeVertices: NormalizedCoord[];
  /** Polygones déjà validés, indépendants les uns des autres. */
  polygons: PlanPolygon[];
  /** Zone sélectionnée (surbrillance + actions disponibles). */
  selectedPolygonId: string | null;
  /** Édition en cours : seuls ces sommets sont déplaçables. */
  editing: PolygonEditingState | null;
  onAddVertex: (vertex: NormalizedCoord) => void;
  /** Fermeture demandée (clic sur le premier sommet). */
  onFinish: () => void;
  /** Sélection d'une zone, ou désélection avec `null`. */
  onSelectPolygon: (polygonId: string | null) => void;
  /** Déplacement d'un sommet pendant l'édition. */
  onMoveVertex: (index: number, vertex: NormalizedCoord) => void;
}

/**
 * Couche Leaflet du mode dessin : rend les polygones validés, le tracé en
 * cours et l'aperçu du segment jusqu'au curseur.
 *
 * Les coordonnées sont stockées en normalisé puis reprojetées à chaque rendu :
 * le zoom, le déplacement et le redimensionnement ne décalent donc jamais les
 * sommets. Les clics sur les contrôles ou sur d'autres marqueurs sont ignorés.
 * En mode édition, chaque sommet devient un marqueur déplaçable.
 */
export function PolygonEditorLayer({
  width,
  height,
  drawing,
  activeVertices,
  polygons,
  selectedPolygonId,
  editing,
  onAddVertex,
  onFinish,
  onSelectPolygon,
  onMoveVertex,
}: PolygonEditorLayerProps) {
  const [cursor, setCursor] = useState<NormalizedCoord | null>(null);

  useMapEvents({
    click(event: LeafletMouseEvent) {
      if (!drawing) {
        if (!editing) onSelectPolygon(null);
        return;
      }

      const target = event.originalEvent.target;
      if (
        target instanceof Element &&
        target.closest('button, a, input, select, textarea, .leaflet-control')
      ) {
        return;
      }

      const data = latlngToData(event.latlng, width, height);
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      onAddVertex(clampCoord(data));
    },
    mousemove(event: LeafletMouseEvent) {
      if (!drawing || activeVertices.length === 0) {
        setCursor(null);
        return;
      }
      const data = latlngToData(event.latlng, width, height);
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) {
        setCursor(null);
        return;
      }
      setCursor(clampCoord(data));
    },
    mouseout() {
      setCursor(null);
    },
  });

  const activePositions = activeVertices.map((vertex) =>
    dataToLatLng(vertex.x, vertex.y, width, height),
  );
  const lastVertex = activeVertices[activeVertices.length - 1];
  const previewPositions =
    cursor && lastVertex
      ? [
          dataToLatLng(lastVertex.x, lastVertex.y, width, height),
          dataToLatLng(cursor.x, cursor.y, width, height),
        ]
      : null;

  return (
    <>
      {polygons.map((polygon, index) => {
        const isEditing = editing?.polygonId === polygon.id;
        const isSelected = selectedPolygonId === polygon.id;
        const vertices = isEditing ? editing.vertices : polygon.vertices;
        const positions = vertices.map((vertex) =>
          dataToLatLng(vertex.x, vertex.y, width, height),
        );

        return (
          <Polygon
            key={polygon.id}
            positions={positions}
            interactive={!drawing && !isEditing}
            bubblingMouseEvents={false}
            eventHandlers={
              !drawing && !isEditing
                ? { click: () => onSelectPolygon(polygon.id) }
                : undefined
            }
            pathOptions={{
              color: isSelected ? POLYGON_SELECTED_COLOR : POLYGON_COLOR,
              weight: isSelected ? 3 : 2,
              opacity: isEditing ? 0.75 : 0.9,
              dashArray: isEditing ? '6 5' : undefined,
              fillColor: isSelected ? POLYGON_SELECTED_COLOR : POLYGON_COLOR,
              fillOpacity: isSelected ? 0.18 : 0.1,
            }}
          >
            <Tooltip permanent direction="center" className="polygon-zone-label">
              Zone {index + 1}
            </Tooltip>
          </Polygon>
        );
      })}

      {editing &&
        editing.vertices.map((vertex, index) => (
          <Marker
            key={`edit-${editing.polygonId}-${index}`}
            position={dataToLatLng(vertex.x, vertex.y, width, height)}
            icon={EDIT_VERTEX_ICON}
            draggable
            bubblingMouseEvents={false}
            eventHandlers={{
              dragend: (event) => {
                const marker = event.target as L.Marker;
                const latlng = marker.getLatLng();
                const data = latlngToData(latlng, width, height);
                if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
                onMoveVertex(index, clampCoord(data));
              },
            }}
          />
        ))}

      {activePositions.length >= 2 && (
        <Polyline
          positions={activePositions}
          interactive={false}
          bubblingMouseEvents={false}
          pathOptions={{ color: POLYGON_COLOR, weight: 2 }}
        />
      )}

      {drawing && previewPositions && (
        <Polyline
          positions={previewPositions}
          interactive={false}
          bubblingMouseEvents={false}
          pathOptions={{ color: POLYGON_COLOR, weight: 2, dashArray: '4 6', opacity: 0.8 }}
        />
      )}

      {drawing &&
        activePositions.map((position, index) => (
          <CircleMarker
            key={`vertex-${index}`}
            center={position}
            radius={index === 0 ? 9 : 6}
            bubblingMouseEvents={false}
            eventHandlers={
              index === 0 && activeVertices.length >= 3 ? { click: onFinish } : undefined
            }
            pathOptions={{
              color: OUTLINE_COLOR,
              weight: 2,
              fillColor: index === 0 ? FIRST_VERTEX_COLOR : VERTEX_COLOR,
              fillOpacity: 1,
            }}
          >
            {index === 0 && activeVertices.length >= 3 && (
              <Tooltip direction="top" offset={[0, -8]}>
                Cliquer pour terminer le polygone
              </Tooltip>
            )}
          </CircleMarker>
        ))}
    </>
  );
}
