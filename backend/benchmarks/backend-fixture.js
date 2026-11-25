function macAddress(index) {
  return [
    0x02,
    (index >> 16) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
    (index * 7) & 0xff,
    (index * 13) & 0xff,
  ]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join(':');
}

function rssiLevel(rssi) {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'good';
  if (rssi >= -75) return 'fair';
  if (rssi >= -85) return 'weak';
  return 'very_weak';
}

function qualityFor(rssi) {
  return Math.max(0, Math.min(100, Math.round((rssi + 100) * 2)));
}

const PLAN_SIZES = [
  { width: 2400, height: 1600 },
  { width: 1600, height: 1000 },
  { width: 1200, height: 800 },
  { width: 1000, height: 1000 },
  { width: 4000, height: 3000 },
];

const SSIDS = Array.from({ length: 20 }, (_, index) => `SSID-${index + 1}`);
export function seedDatabase(db, options) {
  const BSSIDS = Array.from({ length: options.bssids }, (_, index) => macAddress(index + 1));
  const now = Date.UTC(2025, 0, 1);
  const insertPlan = db.prepare(
    `INSERT INTO plans (id, name, file_name, stored_file, image_url, mime, width, height, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSurvey = db.prepare(
    `INSERT INTO surveys (id, plan_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertAccessPoint = db.prepare(
    `INSERT INTO access_points (id, plan_id, name, x, y, bssids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPolygon = db.prepare(
    `INSERT INTO polygons (id, plan_id, vertices, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertApPosition = db.prepare(
    `INSERT INTO ap_positions (plan_id, bssid, x, y, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertMapping = db.prepare(
    `INSERT INTO ap_mappings (id, plan_id, name, bssid, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  const insertPoint = db.prepare(
    `INSERT INTO scan_points (id, plan_id, survey_id, x, y, note, is_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertScan = db.prepare(
    `INSERT INTO scans (id, scan_point_id, plan_id, mode, scanned_at, rejected_count,
                        gateway_ip, gateway_rtt_ms, gateway_loss_percent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertObservation = db.prepare(
    `INSERT INTO observations
      (scan_id, bssid, ssid, hidden, band, frequency_mhz, channel, bandwidth_mhz,
       center_frequency_mhz, center_channel, rssi, quality, level, security,
       standard, virtual_bssid, unreliable_bssid, current, capabilities, timestamp_us)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSpeed = db.prepare(
    `INSERT INTO speed_tests (scan_id, tcp_down_bps, tcp_up_bps, duration_s, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO bssid_rules (id, bssid, name, blacklisted, created_at) VALUES (?, ?, ?, ?, ?)`
  );

  const cols = Math.ceil(Math.sqrt(options.pointsPerPlan * 1.5));
  const rows = Math.ceil(options.pointsPerPlan / cols);

  for (let ruleIndex = 0; ruleIndex < BSSIDS.length; ruleIndex += 1) {
    insertRule.run(
      `rule-${ruleIndex}`,
      BSSIDS[ruleIndex],
      `AP-${ruleIndex + 1}`,
      ruleIndex % 20 === 0 ? 1 : 0,
      '2025-01-01 00:00:00'
    );
  }

  for (let planIndex = 0; planIndex < options.plans; planIndex += 1) {
    const planId = `plan-${String(planIndex).padStart(2, '0')}`;
    const surveyId = `survey-${String(planIndex).padStart(2, '0')}`;
    const size = PLAN_SIZES[planIndex % PLAN_SIZES.length];
    insertPlan.run(
      planId,
      `Plan ${planIndex + 1}`,
      `${planId}.png`,
      `${planId}.png`,
      `/uploads/plans/${planId}.png`,
      'image/png',
      size.width,
      size.height,
      1024 * (planIndex + 1),
      '2025-01-01 00:00:00',
      '2025-01-01 00:00:00'
    );
    insertSurvey.run(surveyId, planId, `Survey ${planIndex + 1}`, '2025-01-01 00:00:00', '2025-01-01 00:00:00');

    for (let apIndex = 0; apIndex < 2; apIndex += 1) {
      const apBssids = [BSSIDS[(planIndex * 4 + apIndex * 2) % BSSIDS.length], BSSIDS[(planIndex * 4 + apIndex * 2 + 1) % BSSIDS.length]];
      insertAccessPoint.run(
        `ap-${planIndex}-${apIndex}`,
        planId,
        `AP-${String(apIndex + 1).padStart(2, '0')}`,
        0.2 + apIndex * 0.55,
        0.3 + apIndex * 0.4,
        JSON.stringify(apBssids),
        '2025-01-01 00:00:00'
      );
    }

    const vertices = JSON.stringify([
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ]);
    insertPolygon.run(`polygon-${planIndex}`, planId, vertices, '2025-01-01 00:00:00', '2025-01-01 00:00:00');

    for (let positionIndex = 0; positionIndex < 4; positionIndex += 1) {
      insertApPosition.run(
        planId,
        BSSIDS[(planIndex * 4 + positionIndex) % BSSIDS.length],
        0.15 + positionIndex * 0.2,
        0.2 + positionIndex * 0.18,
        '2025-01-01 00:00:00'
      );
    }

    for (let mappingIndex = 0; mappingIndex < 2; mappingIndex += 1) {
      insertMapping.run(
        `mapping-${planIndex}-${mappingIndex}`,
        planId,
        `Borne ${mappingIndex + 1}`,
        BSSIDS[(planIndex * 3 + mappingIndex) % BSSIDS.length],
        '2025-01-01 00:00:00'
      );
    }

    for (let pointIndex = 0; pointIndex < options.pointsPerPlan; pointIndex += 1) {
      const pointId = `point-${planIndex}-${pointIndex}`;
      const x = 0.05 + (0.9 * ((pointIndex % cols) + 0.5)) / cols;
      const y = 0.05 + (0.9 * (Math.floor(pointIndex / cols) + 0.5)) / rows;
      insertPoint.run(
        pointId,
        planId,
        surveyId,
        x,
        y,
        pointIndex % 7 === 0 ? `Note ${pointIndex}` : null,
        pointIndex % 10 === 9 ? 0 : 1,
        '2025-01-01 00:00:00'
      );

      for (let scanIndex = 0; scanIndex < options.scansPerPoint; scanIndex += 1) {
        const scanId = `scan-${planIndex}-${pointIndex}-${scanIndex}`;
        const scannedAt = new Date(now + (planIndex * 100000 + pointIndex * 100 + scanIndex) * 60000).toISOString();
        insertScan.run(
          scanId,
          pointId,
          planId,
          'test',
          scannedAt,
          0,
          '192.168.1.1',
          8 + ((pointIndex + scanIndex) % 20),
          ((pointIndex * 3) % 7) / 10,
          scannedAt
        );

        for (let observationIndex = 0; observationIndex < options.observationsPerScan; observationIndex += 1) {
          const bssidIndex = (pointIndex * 13 + observationIndex * 7 + planIndex * 11 + scanIndex * 3) % BSSIDS.length;
          const rssi = -45 - ((pointIndex * 17 + observationIndex * 11 + planIndex * 5) % 45);
          const band5 = observationIndex % 2 === 0;
          const frequency = band5 ? 5180 + (observationIndex % 8) * 20 : 2412 + (observationIndex % 11) * 5;
          const channel = band5 ? 36 + (observationIndex % 8) * 4 : 1 + (observationIndex % 11);
          insertObservation.run(
            scanId,
            BSSIDS[bssidIndex],
            SSIDS[(bssidIndex + planIndex) % SSIDS.length],
            0,
            band5 ? '5GHz' : '2.4GHz',
            frequency,
            channel,
            band5 ? 80 : 20,
            frequency,
            channel,
            rssi,
            qualityFor(rssi),
            rssiLevel(rssi),
            'WPA2',
            '802.11ac',
            0,
            0,
            observationIndex === 0 ? 1 : 0,
            '[]',
            1700000000000 + observationIndex
          );
        }

        if ((pointIndex + scanIndex) % 3 === 0) {
          insertSpeed.run(
            scanId,
            50_000_000 + ((pointIndex * 17 + scanIndex * 31) % 450) * 1_000_000,
            20_000_000 + ((pointIndex * 11 + scanIndex * 13) % 180) * 1_000_000,
            5,
            null,
            scannedAt
          );
        }
      }
    }
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q) => {
    if (sorted.length === 0) return 0;
    const index = (sorted.length - 1) * q;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    min: round(sorted[0]),
    p50: round(quantile(0.5)),
    p95: round(quantile(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    stddev: round(Math.sqrt(variance)),
    samples: values.length,
  };
}
