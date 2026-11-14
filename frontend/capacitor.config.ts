import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.acttwomobile.app',
  appName: '拉图',
  webDir: 'dist',
  plugins: { CapacitorHttp: { enabled: true } },
  server: {
    androidScheme: 'http',
  },
}

export default config
