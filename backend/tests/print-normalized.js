process.env.SCAN_MODE = 'test';
const { getNormalizedScan } = await import('../src/services/scan.services.js');

const result = await getNormalizedScan();
console.table(
  result.data.map(({ bssid, ssid, band, channel, bandwidth_mhz, rssi, quality, security, standard, virtual_bssid }) => ({
    bssid, ssid, band, channel, bandwidth_mhz, rssi, quality, security, standard, virtual_bssid,
  }))
);
console.log(JSON.stringify(result.data, null, 2));