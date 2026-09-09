import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: { dynamic: 2_147_483_647, static: 2_147_483_647 },
  },
};

export default nextConfig;
