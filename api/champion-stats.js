import { handleApiRequest } from "../src/api-core.mjs";

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const result = await handleApiRequest({
    method: request.method,
    pathname: "/api/champion-stats",
    searchParams: url.searchParams
  });
  response.status(result.status).json(result.body);
}
