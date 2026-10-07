// STATIC_EXPORT=1 builds a fully static demo (e.g. for GitHub Pages).
// The demo runs entirely in the browser; the optional Qlik API route
// needs a server and is therefore left out of static builds.
const isStatic = process.env.STATIC_EXPORT === "1";
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = isStatic
  ? { output: "export", basePath, trailingSlash: true, images: { unoptimized: true } }
  : {};

export default nextConfig;
