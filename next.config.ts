import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Notes autosave is a Server Action that sends the whole Tiptap doc, which
    // can include base64-embedded images. Next caps Server Action request bodies
    // at 1MB by default, so image-bearing saves were silently rejected server-side
    // (the image showed in the editor and rode to chat — both in-memory — but
    // never persisted, so it vanished on reload). Raise the limit to match the
    // site-wide nginx client_max_body_size (30m). Chat's image upload goes through
    // a route handler (/api/chat), not a Server Action, so it was never affected.
    serverActions: {
      bodySizeLimit: "24mb",
    },
  },
};

export default nextConfig;
