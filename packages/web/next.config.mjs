/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  rewrites: async () => [
    { source: '/api/:path*', destination: 'http://127.0.0.1:7423/api/:path*' },
  ],
};

export default config;
