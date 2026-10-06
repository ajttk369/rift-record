import { handleApiRequest } from "./api-core.mjs";
import { securityHeaders } from "./security.mjs";

export function createApiHandler(pathname) {
  return async (request, response) => {
    const url = new URL(request.url, "https://rift-record.vercel.app");
    const result = await handleApiRequest({
      method: request.method, pathname, searchParams: url.searchParams,
      headers: request.headers,
      clientId: request.headers["x-vercel-forwarded-for"] || request.socket?.remoteAddress
    });
    for (const [key, value] of Object.entries({ ...securityHeaders, "Cache-Control": "no-store", ...result.headers })) response.setHeader(key, value);
    response.status(result.status).json(result.body);
  };
}
