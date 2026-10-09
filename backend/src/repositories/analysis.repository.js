import { getDb } from '../database/db.js';
import { withBssidNames } from './bssidRules.repository.js';

export function listStrongestObservationsBySurvey(survey_id) {
  const db = getDb();
  return withBssidNames(db
    .prepare(
      `WITH ranked_observations AS (
         SELECT sp.id AS scan_point_id, sp.x, sp.y, sp.note,
                s.id AS scan_id, s.scanned_at,
                o.bssid, o.ssid, o.rssi, o.channel,
                ROW_NUMBER() OVER (
                  PARTITION BY sp.id, o.bssid
                  ORDER BY o.rssi DESC, s.scanned_at DESC, s.created_at DESC
                ) AS observation_rank
         FROM scan_points sp
         JOIN scans s ON s.scan_point_id = sp.id
         JOIN observations o ON o.scan_id = s.id
         WHERE sp.survey_id = ? AND sp.is_enabled = 1
           AND NOT EXISTS (
             SELECT 1 FROM bssid_rules br WHERE br.bssid = o.bssid AND br.blacklisted = 1
           )
       )
       SELECT scan_point_id, x, y, note, scan_id, scanned_at,
              bssid, ssid, rssi, channel
       FROM ranked_observations
       WHERE observation_rank = 1
       ORDER BY scan_point_id, rssi DESC, bssid`
    )
    .all(survey_id));
}
