/**
 * After a Redis failure, skip Redis for a few seconds. A hung Redis would
 * otherwise add its full command timeout to every request.
 */
const OPEN_MS = 5_000;
let openUntil = 0;

export const redisBreakerOpen = () => Date.now() < openUntil;
export const tripRedisBreaker = () => { openUntil = Date.now() + OPEN_MS; };
