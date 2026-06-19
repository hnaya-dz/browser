/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // Export statique pour Electron
  eslint: {
    // Les warnings ESLint n'empêchent pas le build de production
    ignoreDuringBuilds: true,
  },
  images: {
    // Nécessaire pour l'export statique
    unoptimized: true,
  },
};

export default nextConfig;
