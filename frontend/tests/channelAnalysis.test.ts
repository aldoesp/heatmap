import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateChannelNetworks,
  channelDomain,
  channelFromFrequency,
  channelSpan,
  filterBestNetworks,
  findChannelOverlaps,
  type ChannelSample,
} from '../src/lib/channelAnalysis.js';

function sample(overrides: Partial<ChannelSample> = {}): ChannelSample {
  return {
    bssid: 'aa:bb:cc:dd:ee:01',
    bssid_name: 'AP test',
    ssid: 'Maison',
    hidden: false,
    band: '2.4GHz',
    frequency_mhz: 2412,
    channel: 1,
    bandwidth_mhz: 20,
    center_frequency_mhz: 2412,
    center_channel: 1,
    rssi: -50,
    quality: 100,
    level: 'excellent',
    security: 'WPA2',
    standard: 'wifi4 (802.11n)',
    virtual_bssid: false,
    unreliable_bssid: false,
    current: false,
    capabilities: [],
    timestamp_us: null,
    scanned_at: '2026-11-17T10:00:00.000Z',
    scan_point_id: 'point-1',
    ...overrides,
  };
}

describe('analyse des canaux Wi-Fi', () => {
  it('déduit le canal depuis la fréquence', () => {
    assert.equal(channelFromFrequency(2412), 1);
    assert.equal(channelFromFrequency(2437), 6);
    assert.equal(channelFromFrequency(2484), 14);
    assert.equal(channelFromFrequency(5180), 36);
  });

  it('sépare deux BSSID qui partagent le même SSID', () => {
    const networks = aggregateChannelNetworks(
      [
        sample({ bssid: 'aa:bb:cc:dd:ee:01', rssi: -48 }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:02',
          ssid: 'Maison',
          channel: 6,
          frequency_mhz: 2437,
          center_frequency_mhz: 2437,
          center_channel: 6,
          rssi: -62,
        }),
      ],
      '2.4',
    );

    assert.equal(networks.length, 2);
    assert.deepEqual(
      networks.map((network) => network.ssid),
      ['Maison', 'Maison'],
    );
    assert.deepEqual(
      new Set(networks.map((network) => network.bssid)),
      new Set(['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02']),
    );
  });

  it('ne garde que le meilleur AP par SSID quand le filtre est actif', () => {
    const networks = aggregateChannelNetworks(
      [
        sample({ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Maison', rssi: -72 }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:02',
          ssid: 'Maison',
          channel: 6,
          frequency_mhz: 2437,
          center_frequency_mhz: 2437,
          center_channel: 6,
          rssi: -49,
        }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:03',
          ssid: 'Voisin',
          channel: 11,
          frequency_mhz: 2462,
          center_frequency_mhz: 2462,
          center_channel: 11,
          rssi: -80,
        }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:04',
          ssid: null,
          hidden: true,
          channel: 9,
          frequency_mhz: 2452,
          center_frequency_mhz: 2452,
          center_channel: 9,
          rssi: -66,
        }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:05',
          ssid: null,
          hidden: true,
          channel: 10,
          frequency_mhz: 2457,
          center_frequency_mhz: 2457,
          center_channel: 10,
          rssi: -85,
        }),
      ],
      '2.4',
    );

    const best = filterBestNetworks(networks);
    assert.deepEqual(
      new Set(best.map((network) => network.bssid)),
      new Set([
        'aa:bb:cc:dd:ee:02',
        'aa:bb:cc:dd:ee:03',
        'aa:bb:cc:dd:ee:04',
        'aa:bb:cc:dd:ee:05',
      ]),
    );
    // Le SSID reste celui du BSSID conservé, pas confondu avec son adresse.
    assert.equal(
      best.find((network) => network.bssid === 'aa:bb:cc:dd:ee:02')?.ssid,
      'Maison',
    );
    assert.equal(filterBestNetworks(networks).length, 4);
  });

  it('garde le meilleur RSSI et compte les observations par BSSID', () => {
    const networks = aggregateChannelNetworks(
      [
        sample({ rssi: -70, scanned_at: '2026-11-17T10:00:00.000Z' }),
        sample({ rssi: -54, scanned_at: '2026-11-17T11:00:00.000Z', scan_point_id: 'point-2' }),
        sample({ rssi: -61, scanned_at: '2026-11-17T09:00:00.000Z', scan_point_id: 'point-3' }),
      ],
      '2.4',
    );

    assert.equal(networks.length, 1);
    assert.equal(networks[0].rssi, -54);
    assert.equal(networks[0].sampleCount, 3);
    assert.equal(networks[0].pointCount, 3);
    assert.equal(networks[0].lastSeen, '2026-11-17T11:00:00.000Z');
  });

  it('retrouve le canal via la fréquence quand channel est null', () => {
    const networks = aggregateChannelNetworks(
      [sample({ channel: null, frequency_mhz: 2437, center_frequency_mhz: 2437 })],
      '2.4',
    );

    assert.equal(networks[0].channel, 6);
  });

  it('ignore les bandes non prises en charge par le MVP', () => {
    const networks24 = aggregateChannelNetworks(
      [
        sample(),
        sample({
          bssid: 'aa:bb:cc:dd:ee:03',
          band: '6GHz',
          channel: 37,
          frequency_mhz: 6135,
          center_frequency_mhz: 6135,
          center_channel: 37,
        }),
      ],
      '2.4',
    );

    assert.equal(networks24.length, 1);
    assert.equal(networks24[0].bssid, 'aa:bb:cc:dd:ee:01');
  });

  it('détecte un chevauchement 20 MHz entre canaux 1 et 2, pas entre 1 et 6', () => {
    const adjacent = aggregateChannelNetworks(
      [
        sample({ bssid: 'aa:bb:cc:dd:ee:01', channel: 1 }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:02',
          channel: 2,
          frequency_mhz: 2417,
          center_frequency_mhz: 2417,
          center_channel: 2,
          rssi: -60,
        }),
      ],
      '2.4',
    );
    const separated = aggregateChannelNetworks(
      [
        sample({ bssid: 'aa:bb:cc:dd:ee:01', channel: 1 }),
        sample({
          bssid: 'aa:bb:cc:dd:ee:02',
          channel: 6,
          frequency_mhz: 2437,
          center_frequency_mhz: 2437,
          center_channel: 6,
          rssi: -60,
        }),
      ],
      '2.4',
    );

    const adjacentOverlaps = findChannelOverlaps(adjacent);
    assert.equal(adjacentOverlaps.length, 1);
    assert.equal(adjacentOverlaps[0].overlapMhz, 15);

    assert.equal(findChannelOverlaps(separated).length, 0);
  });

  it('signale une largeur non mesurée au lieu de la présenter comme réelle', () => {
    const networks = aggregateChannelNetworks(
      [sample({ bandwidth_mhz: null })],
      '2.4',
    );

    assert.equal(networks[0].bandwidthMhz, null);
    assert.equal(networks[0].widthMhz, 20);
    assert.equal(networks[0].widthEstimated, true);
    assert.equal(channelSpan(networks[0]).estimated, true);
  });

  it('élargit le domaine 5 GHz aux largeurs observées', () => {
    const networks = aggregateChannelNetworks(
      [
        sample({
          bssid: 'aa:bb:cc:dd:ee:10',
          band: '5GHz',
          channel: 36,
          frequency_mhz: 5180,
          center_frequency_mhz: 5190,
          center_channel: 38,
          bandwidth_mhz: 80,
        }),
      ],
      '5',
    );

    assert.equal(networks[0].centerChannel, 38);
    assert.equal(networks[0].widthMhz, 80);

    const domain = channelDomain('5', networks);
    assert.ok(domain.min <= 34);
    assert.ok(domain.max >= 42);
    assert.ok(domain.ticks.length > 0);
  });
});
