/** 统一 HTTP JSON 响应壳 */
export type ApiResponse<T = unknown> = {
  success: boolean;
  code: string;
  message: string;
  data: T;
};

export function apiOk<T>(data: T, message = "ok", code = "OK"): ApiResponse<T> {
  return { success: true, code, message, data };
}

export function apiFail(code: string, message?: string, data: unknown = null): ApiResponse<null> {
  return {
    success: false,
    code,
    message: message ?? code,
    data: null,
  };
}
