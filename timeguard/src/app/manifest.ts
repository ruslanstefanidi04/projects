import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TIMEGUARD",
    short_name: "TIMEGUARD",
    start_url: "/day",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
  };
}
