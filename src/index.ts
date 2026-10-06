import { handleApi } from "./api";
import { dashboardPage } from "./dashboard-page";
import type { Env } from "./types";

export { Monitor } from "./monitor";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        service: "Farpoint",
        status: "ok",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/dashboard") {
      return dashboardPage();
    }

    if (url.pathname.startsWith("/api/v1/")) {
      return handleApi(request, env);
    }

    return new Response("Farpoint is watching. 👀", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
