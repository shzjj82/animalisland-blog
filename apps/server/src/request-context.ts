import { AsyncLocalStorage } from "node:async_hooks";

export type RequestStore = {
  accessToken?: string;
  user?: {
    id: string;
    username: string | null;
    nickname: string;
    role: string;
    roles: string[];
  };
};

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getAccessToken(): string | undefined {
  return requestContext.getStore()?.accessToken;
}

export function getAuthUser(): RequestStore["user"] | undefined {
  return requestContext.getStore()?.user;
}
