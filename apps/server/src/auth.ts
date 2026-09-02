import type { RequestHandler } from "express";
import { jwtVerify, SignJWT } from "jose";
import { env } from "./env.js";

const secret = new TextEncoder().encode(env.jwtSecret);

export async function signToken(): Promise<string> {
  return new SignJWT({ sub: env.adminUsername, role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.jwtExpiresDays}d`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.token as string | undefined;
  if (!token || !(await verifyToken(token))) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  next();
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.token as string | undefined;
  if (token && (await verifyToken(token))) {
    req.authed = true;
  }
  next();
};

declare global {
  namespace Express {
    interface Request {
      authed?: boolean;
    }
  }
}
