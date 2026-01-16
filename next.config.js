/** @type {import('next').NextConfig} */
const nextConfig = {
  // Public widget script should be cached forever
  async headers() {
    return [
      {
        source: '/widget.v1.0.0.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Embed page should not be cached
        source: '/embed',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

