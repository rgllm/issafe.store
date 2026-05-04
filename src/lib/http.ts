export type ApiErrorBody = {
  error: string
}

export function jsonResponse<T>(body: T, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

export function errorResponse(error: string, status = 400) {
  return jsonResponse<ApiErrorBody>({ error }, { status })
}
