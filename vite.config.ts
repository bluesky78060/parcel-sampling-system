import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: '/parcel-sampling-system/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // 순수 함수 회귀 테스트다. DOM이 필요한 컴포넌트 테스트를 넣게 되면
    // 그때 jsdom 환경을 별도 프로젝트로 분리한다.
    environment: 'node',
    // .tsx도 잡는다. 컴포넌트 테스트를 추가했을 때 조용히 실행되지 않는 것이
    // 가장 나쁘다 — 실패도 안 나므로 아무도 눈치채지 못한다.
    // DOM이 필요해지면 그때 environment만 프로젝트별로 나눈다.
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    proxy: {
      '/api/vworld': {
        target: 'https://api.vworld.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/vworld/, ''),
      },
      '/api/kakao': {
        target: 'https://dapi.kakao.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kakao/, ''),
      },
    },
  },
})
