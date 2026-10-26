// Tests unitaires des parseurs ping/passerelle (sans réseau, déterministes).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDefaultGateway,
  parsePingOutput,
  isPlaceholderBssid,
  PLACEHOLDER_BSSID,
} from '../src/utils/ping.utils.js';
import { toMbps } from '../src/services/iperf.service.js';

describe('parseDefaultGateway', () => {
  it('extrait la passerelle IPv4 (ip route)', () => {
    assert.equal(
      parseDefaultGateway('default via 192.168.1.1 dev wlan0 proto dhcp metric 600\n'),
      '192.168.1.1'
    );
  });

  it('null sans route par défaut', () => {
    assert.equal(parseDefaultGateway('192.168.1.0/24 dev wlan0 proto kernel\n'), null);
    assert.equal(parseDefaultGateway(''), null);
  });
});

describe('parsePingOutput', () => {
  const LINUX_PING = `PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=3.42 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=2.91 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=3.10 ms
64 bytes from 192.168.1.1: icmp_seq=4 ttl=64 time=4.02 ms
64 bytes from 192.168.1.1: icmp_seq=5 ttl=64 time=3.55 ms

--- 192.168.1.1 ping statistics ---
5 packets transmitted, 5 received, 0% packet loss, time 4006ms`;

  it('médiane + 0% perte (anglais)', () => {
    const r = parsePingOutput(LINUX_PING, '192.168.1.1');
    assert.equal(r.gatewayIp, '192.168.1.1');
    assert.equal(r.medianRttMs, 3.42);
    assert.equal(r.packetLossPercent, 0);
    assert.equal(r.probesSent, 5);
    assert.equal(r.probesReceived, 5);
  });

  it('perte partielle sans résumé (déduite des réponses)', () => {
    const out = `64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=12,5 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=9,0 ms`;
    const r = parsePingOutput(out, '192.168.1.1');
    assert.equal(r.medianRttMs, 10.75);
    assert.equal(r.packetLossPercent, 60);
    assert.equal(r.probesReceived, 2);
  });

  it('perte en français', () => {
    const out = `5 packets transmitted, 3 received, 40% packet loss
64 bytes from 192.168.1.1: time=5.0 ms`;
    const r = parsePingOutput(out, '192.168.1.1');
    assert.equal(r.packetLossPercent, 40);
  });

  it('null si sortie vide', () => {
    assert.equal(parsePingOutput('', '192.168.1.1'), null);
    assert.equal(parsePingOutput('ping: unknown host', '192.168.1.1'), null);
  });
});

describe('isPlaceholderBssid', () => {
  it('détecte le faux BSSID Android', () => {
    assert.ok(isPlaceholderBssid(PLACEHOLDER_BSSID));
    assert.ok(isPlaceholderBssid('02:00:00:00:00:00'));
    assert.ok(!isPlaceholderBssid('8c:30:66:74:50:83'));
    assert.ok(!isPlaceholderBssid(null));
  });
});

describe('toMbps', () => {
  it('convertit les bits/s en Mb/s', () => {
    assert.equal(toMbps(50_000_000), 50);
    assert.equal(toMbps(12_345_678), 12.35);
    assert.equal(toMbps(null), null);
    assert.equal(toMbps(undefined), null);
  });
});
