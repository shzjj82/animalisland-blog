import type { Response } from "express";
import { apiFail, apiOk, type ApiResponse } from "@myblog/shared";

/** 成功响应：HTTP 状态默认 200，body 为统一壳 */
export function ok<T>(res: Response, data: T, status = 200, message = "ok", code = "OK"): Response {
  const body: ApiResponse<T> = apiOk(data, message, code);
  return res.status(status).json(body);
}

/** 失败响应：HTTP 状态 + 统一壳；code 默认即业务错误码 */
export function fail(
  res: Response,
  code: string,
  status = 400,
  message?: string,
  data: unknown = null,
): Response {
  const body: ApiResponse<null> = apiFail(code, message, data);
  return res.status(status).json(body);
}
