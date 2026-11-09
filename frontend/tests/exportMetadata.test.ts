import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExportMetadataFields,
  exportMetadataLayout,
  formatExportDate,
  formatWifiBand,
  truncateText,
} from '../src/lib/exportMetadata.js';

const measure = (value: string) => value.length * 10;

describe('métadonnées de l’export PNG', () => {
  it('affiche les filtres réels et les mentions Tous/Toutes', () => {
    const fields = buildExportMetadataFields({
      planName: 'Étage 2',
      ssid: '',
      bssid: '',
      band: '',
      calculation: 'regularized',
      exportedAt: new Date(2026, 10, 9, 14, 5, 7),
    });
    assert.deepEqual(fields, [
      { label: 'Plan', value: 'Étage 2' },
      { label: 'SSID', value: 'Tous' },
      { label: 'BSSID', value: 'Tous' },
      { label: 'Bande', value: 'Toutes' },
      { label: 'Calcul', value: 'Régularisé' },
      { label: 'Export', value: '09/11/2026 14:05:07' },
    ]);
  });

  it('reprend les valeurs sélectionnées', () => {
    const fields = buildExportMetadataFields({
      planName: 'RDC',
      ssid: 'MonWifi',
      bssid: 'aa:bb:cc:dd:ee:01',
      band: '5',
      calculation: 'hybrid',
      exportedAt: new Date(2026, 0, 2, 3, 4, 5),
    });
    assert.equal(fields[1].value, 'MonWifi');
    assert.equal(fields[2].value, 'aa:bb:cc:dd:ee:01');
    assert.equal(fields[3].value, '5 GHz');
    assert.equal(fields[4].value, 'Hybride existant');
    assert.equal(fields[5].value, '02/01/2026 03:04:05');
  });

  it('adapte le nombre de colonnes à la largeur', () => {
    assert.equal(exportMetadataLayout(400, 300, 6).columns, 1);
    assert.equal(exportMetadataLayout(1000, 800, 6).columns, 2);
    assert.equal(exportMetadataLayout(2400, 1200, 6).columns, 3);
    const layout = exportMetadataLayout(1000, 800, 6);
    assert.ok(layout.height > 0);
    assert.equal(layout.rows, 3);
  });

  it('tronque les valeurs trop longues avec une ellipse', () => {
    assert.equal(truncateText('abcdefghij', 45, measure), 'abc…');
    assert.equal(truncateText('abcdefghij', 500, measure), 'abcdefghij');
    assert.equal(truncateText('abcdefghij', 0, measure), '');
  });

  it('formate les bandes connues et conserve les valeurs inconnues', () => {
    assert.equal(formatWifiBand(''), 'Toutes');
    assert.equal(formatWifiBand('2.4'), '2.4 GHz');
    assert.equal(formatWifiBand('6'), '6 GHz');
    assert.equal(formatWifiBand('60 GHz'), '60 GHz');
    assert.equal(formatExportDate(new Date(2026, 10, 9, 0, 0, 0)), '09/11/2026 00:00:00');
  });
});
