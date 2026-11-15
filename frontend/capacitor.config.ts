import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.latula.mobile',
  appName: '拉图',
  webDir: 'dist',
  backgroundColor: '#080e18',
  plugins: { CapacitorHttp: { enabled: true }, SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' } },
  server: {
    androidScheme: 'http',
  },
}

export default config
