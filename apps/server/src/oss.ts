import crypto from "node:crypto";
import OSS from "ali-oss";
import { env, ossConfigured } from "./env.js";

let client: OSS | null = null;

function getClient(): OSS {
  if (!ossConfigured()) {
    throw new Error("OSS_NOT_CONFIGURED");
  }
  if (!client) {
    client = new OSS({
      region: env.ossRegion,
      accessKeyId: env.ossAccessKeyId,
      accessKeySecret: env.ossAccessKeySecret,
      bucket: env.ossBucket,
      secure: true,
      authorizationV4: true,
    });
  }
  return client;
}

export function publicObjectUrl(key: string): string {
  if (env.ossPublicBase) {
    return `${env.ossPublicBase}/${key}`;
  }
  return `https://${env.ossBucket}.${env.ossRegion}.aliyuncs.com/${key}`;
}

export async function uploadImageToOss(file: { buffer: Buffer; mimetype: string; ext: string }): Promise<{ url: string; key: string }> {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = env.ossPrefix || "blog";
  const key = `${prefix}/${year}/${month}/${crypto.randomUUID()}${file.ext}`;

  await getClient().put(key, file.buffer, {
    mime: file.mimetype,
    headers: {
      "x-oss-object-acl": "public-read",
    },
  });

  return { url: publicObjectUrl(key), key };
}
