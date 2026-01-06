import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.coolgroove.sistema',
  appName: 'CoolGroove',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      autoUpdate: true,
    }
  }
};

export default config;
