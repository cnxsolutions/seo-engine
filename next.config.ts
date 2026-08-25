import type { NextConfig } from "next";

/**
 * `standalone` emits `.next/standalone/server.js`: a self-contained Node server
 * carrying only the dependencies Next actually traced. It is what the Dockerfile
 * copies into its `runner` stage, and the image cannot be built without it.
 *
 * It is opt-in rather than always-on because the tracing step CANNOT COMPLETE on
 * Windows. Turbopack emits chunks whose filename contains the module specifier,
 * so a route importing `node:fs` produces `[externals]_node:fs_<hash>._.js`; NTFS
 * reserves `:` for alternate data streams, the copy into `.next/standalone` fails
 * with EINVAL, and the build prints a warning while silently leaving that chunk
 * out of the standalone tree. The output is legal on Linux, which is the only
 * place it is ever run.
 *
 * So: `npm run build` stays clean on a developer machine, and the Dockerfile
 * builder sets BUILD_STANDALONE=1 (see its `RUN` line) to get the real thing.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;
