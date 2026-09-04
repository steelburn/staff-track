// Lightweight in-memory sliding-window rate limiter. Per-process only —
// resets on restart. Fine for an internal tool; documented as a limitation.

export function rateLimit({ windowMs = 60000, max = 300, keyFn = null, message = 'Too many requests' }) {
    const hits = new Map(); // key -> { count, resetAt }

    return function rateLimitMiddleware(req, res, next) {
        const key = keyFn ? keyFn(req) : req.ip;
        const now = Date.now();

        if (hits.size > 10000) {
            for (const [k, rec] of hits) {
                if (rec.resetAt <= now) hits.delete(k);
            }
        }

        const rec = hits.get(key);
        if (!rec || rec.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        rec.count += 1;
        if (rec.count > max) {
            res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
            return res.status(429).json({ error: message });
        }
        next();
    };
}
