/**
 * 本地 SQLite 用户认证（未配置 Nest 网关时使用）。
 * Cookie / 响应形状与 Nest usercenter 对齐，便于前后端同一套登录注册。
 */
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db.js";
import { env, hasGatewayConfig } from "./env.js";
import type { UcAuthResult, UcUser } from "./uc-client.js";

const ACCESS_TTL_SEC = 2 * 60 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

type LocalUserRow = {
  id: string;
  username: string;
  nickname: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
};

let ensured = false;

function secretKey() {
  const raw = process.env.LOCAL_AUTH_SECRET || `local-dev:${env.databasePath}`;
  return crypto.createHash("sha256").update(raw).digest();
}

function hashPassword(password: string, salt = crypto.randomBytes(16)): string {
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function ensureLocalAuthSchema(): void {
  if (ensured) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_users_username ON local_users (username);
  `);
  ensured = true;
}

function toUcUser(row: LocalUserRow): UcUser {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: row.role,
    roles: [row.role],
  };
}

async function signPair(user: UcUser): Promise<UcAuthResult> {
  const key = secretKey();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
    roles: user.roles,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SEC)
    .sign(key);

  const refreshToken = await new SignJWT({
    sub: user.id,
    typ: "refresh",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TTL_SEC)
    .sign(key);

  return {
    token,
    expiresIn: ACCESS_TTL_SEC,
    refreshToken,
    refreshExpiresIn: REFRESH_TTL_SEC,
    user,
  };
}

function findByUsername(username: string): LocalUserRow | undefined {
  return db
    .prepare("SELECT * FROM local_users WHERE username = ? LIMIT 1")
    .get(username) as LocalUserRow | undefined;
}

function findById(id: string): LocalUserRow | undefined {
  return db.prepare("SELECT * FROM local_users WHERE id = ? LIMIT 1").get(id) as
    | LocalUserRow
    | undefined;
}

export function usesLocalAuth(): boolean {
  return !hasGatewayConfig();
}

/** 本机模式种子账号，与 Nest 默认管理员一致。只在不存在时创建，不覆盖已改过的密码。 */
export function ensureLocalAdmin(): void {
  ensureLocalAuthSchema();
  let row = findByUsername("admin");
  if (!row) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO local_users (id, username, nickname, password_hash, role, created_at, updated_at)
       VALUES (?, 'admin', 'admin', ?, 'admin', ?, ?)`,
    ).run(id, hashPassword("admin123"), now, now);
    row = findById(id);
  }
  if (!row) {
    return;
  }
  db.prepare(
    `UPDATE posts SET author_id = ? WHERE author_id IS NULL OR author_id = ''`,
  ).run(row.id);
}

export async function localRegister(input: {
  username: string;
  password: string;
  nickname?: string;
}): Promise<UcAuthResult> {
  ensureLocalAuthSchema();
  if (findByUsername(input.username)) {
    const err = new Error(`用户名 ${input.username} 已存在`);
    (err as Error & { status: number; code: string }).status = 409;
    (err as Error & { code: string }).code = "USERNAME_TAKEN";
    throw err;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const nickname = input.nickname?.trim() || input.username;
  db.prepare(
    `INSERT INTO local_users (id, username, nickname, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', ?, ?)`,
  ).run(id, input.username, nickname, hashPassword(input.password), now, now);
  return signPair(toUcUser(findById(id)!));
}

export async function localLogin(username: string, password: string): Promise<UcAuthResult> {
  ensureLocalAuthSchema();
  const row = findByUsername(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    const err = new Error("用户名或密码错误");
    (err as Error & { status: number; code: string }).status = 401;
    (err as Error & { code: string }).code = "INVALID_CREDENTIALS";
    throw err;
  }
  return signPair(toUcUser(row));
}

export async function localMe(accessToken: string): Promise<UcUser> {
  ensureLocalAuthSchema();
  try {
    const { payload } = await jwtVerify(accessToken, secretKey());
    if (payload.typ !== "access" || typeof payload.sub !== "string") {
      throw new Error("bad token");
    }
    const row = findById(payload.sub);
    if (!row) {
      throw new Error("missing user");
    }
    return toUcUser(row);
  } catch {
    const err = new Error("UNAUTHORIZED");
    (err as Error & { status: number; code: string }).status = 401;
    (err as Error & { code: string }).code = "UNAUTHORIZED";
    throw err;
  }
}

export async function localRefresh(refreshToken: string): Promise<UcAuthResult> {
  ensureLocalAuthSchema();
  try {
    const { payload } = await jwtVerify(refreshToken, secretKey());
    if (payload.typ !== "refresh" || typeof payload.sub !== "string") {
      throw new Error("bad token");
    }
    const row = findById(payload.sub);
    if (!row) {
      throw new Error("missing user");
    }
    return signPair(toUcUser(row));
  } catch {
    const err = new Error("UNAUTHORIZED");
    (err as Error & { status: number; code: string }).status = 401;
    (err as Error & { code: string }).code = "UNAUTHORIZED";
    throw err;
  }
}

export async function localLogout(): Promise<void> {
  // JWT 无服务端会话；清 cookie 即可
}
