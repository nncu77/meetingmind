/**
 * 簡易 in-memory rate limiter，per-IP per-window。
 *
 * 限制：每個 Vercel function instance 各自獨立計數，多實例下使用者
 * 可能超過名義上限的「實例數倍」。Portfolio 規模可接受；要嚴格控管
 * 應改 Vercel KV / Upstash Redis / Supabase rpc。
 */

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
let lastCleanup = Date.now();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // 偶爾清理過期 bucket 避免 memory leak
  if (now - lastCleanup > 60_000) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
    lastCleanup = now;
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * 從 Next.js Request 抽出 client IP。
 * Vercel 會把 IP 放在 x-forwarded-for 第一個（client 真實 IP），其後是 proxy 鏈。
 */
export function clientIpFromRequest(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? '0.0.0.0';
}
