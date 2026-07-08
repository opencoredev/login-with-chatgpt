import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The docs site lives inside a Bun workspace repo; pin the root so Turbopack
  // doesn't infer the parent directory from the outer lockfile.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withMDX(config);
