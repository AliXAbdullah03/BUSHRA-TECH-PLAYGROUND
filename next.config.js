/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable API routes
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  // Environment variables that should be available on the client (if needed)
  env: {
    // Add any public env vars here if needed
  },
};

module.exports = nextConfig;

