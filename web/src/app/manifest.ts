import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OMEGA PRIME",
    short_name: "OMEGA",
    description: "Global logistics & market intelligence",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0f15",
    theme_color: "#0a0f15",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
