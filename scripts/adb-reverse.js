const { execSync } = require('child_process');

const PORTS = [8085, 3001];

function setupAdbReverse() {
  try {
    // Check if adb is installed and at least one device is connected
    const devicesOutput = execSync('adb devices', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = devicesOutput.trim().split('\n').slice(1);
    const devices = lines
      .map(line => line.trim())
      .filter(line => line.endsWith('device'))
      .map(line => line.split(/\s+/)[0])
      .filter(Boolean);

    if (devices.length === 0) {
      console.log('ℹ️  No ADB devices connected. Skipping adb reverse.');
      return;
    }

    for (const device of devices) {
      for (const port of PORTS) {
        try {
          execSync(`adb -s ${device} reverse tcp:${port} tcp:${port}`, { stdio: 'ignore' });
          console.log(`✅ ADB reverse active for device [${device}] on port ${port}`);
        } catch (e) {
          console.warn(`⚠️  Failed to reverse port ${port} on device [${device}]`);
        }
      }
    }
  } catch (err) {
    // adb not installed or failed to execute
  }
}

setupAdbReverse();
