type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
};

function findEocd(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      return index;
    }
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function listEntries(buffer: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    return [];
  }
  const view = new DataView(buffer);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.push({ name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 只解出 want 选中的条目。docx 里的视频用得到，不必把整包图片都展开。 */
export async function readZip(buffer: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const files = new Map<string, Uint8Array>();
  for (const entry of listEntries(buffer)) {
    if (!want(entry.name) || entry.name.endsWith("/") || entry.compressedSize === 0xffffffff) {
      continue;
    }
    const local = entry.localOffset;
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
      continue;
    }
    const nameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const start = local + 30 + nameLength + extraLength;
    const slice = bytes.subarray(start, start + entry.compressedSize);
    if (slice.length !== entry.compressedSize) {
      continue;
    }
    if (entry.method === 0) {
      files.set(entry.name, new Uint8Array(slice));
    } else if (entry.method === 8) {
      files.set(entry.name, await inflateRaw(slice));
    }
  }
  return files;
}
