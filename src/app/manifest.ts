import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: '쏙쓸계산기', short_name: '쏙쓸계산기', start_url: '/', display: 'standalone',
    background_color: '#f4f6f8', theme_color: '#f4f6f8', lang: 'ko',
    icons: [{ src: '/icon.png', sizes: 'any', type: 'image/png', purpose: 'any' }] };
}
