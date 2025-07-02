require("dotenv").config();
const { Redis } = require("@upstash/redis");

// Initialize Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Cache configuration
const CACHE_TTL = {
  TRANSACTIONS: 30,
  USER_DATA: 180,
  OTP: 300,
  OTP_RATE_LIMIT: 7200,
};

// Cache helper functions
const getCacheKey = (type, userId, extra = "") => {
  return `ewallet:${type}:${userId}${extra ? `:${extra}` : ""}`;
};

const setCache = async (key, data, ttl = 60) => {
  try {
    const serializedData = JSON.stringify(data);
    await redis.setex(key, ttl, serializedData);
    console.log(`✅ Cache set: ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (error) {
    console.error(`❌ Cache set error for key ${key}:`, error.message);
    return false;
  }
};

const getCache = async (key) => {
  try {
    const cached = await redis.get(key);

    if (cached === null || cached === undefined) {
      console.log(`📭 Cache miss: ${key}`);
      return null;
    }

    console.log(`✅ Cache hit: ${key}`);

    try {
      return JSON.parse(cached);
    } catch (parseError) {
      console.error(
        `❌ Cache data is not valid JSON for key ${key}:`,
        parseError.message
      );
      await redis.del(key); // Delete invalid cache
      return null;
    }
  } catch (error) {
    console.error(`❌ Cache get error for key ${key}:`, error.message);
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    const result = await redis.del(key);
    console.log(`🗑️  Cache deleted: ${key} (${result} keys removed)`);
    return result > 0;
  } catch (error) {
    console.error(`❌ Cache delete error for key ${key}:`, error.message);
    return false;
  }
};

const deleteCachePattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys && keys.length > 0) {
      await redis.del(...keys);
      console.log(
        `🗑️  Cache pattern deleted: ${pattern} (${keys.length} keys)`
      );
      return keys.length;
    } else {
      console.log(`📭 No keys found for pattern: ${pattern}`);
      return 0;
    }
  } catch (error) {
    console.error(
      `❌ Cache pattern delete error for ${pattern}:`,
      error.message
    );
    return 0;
  }
};

const invalidateUserCache = async (userId) => {
  try {
    const results = await Promise.allSettled([
      deleteCachePattern(`ewallet:transactions:${userId}*`),
      deleteCachePattern(`ewallet:user:${userId}*`),
      deleteCachePattern(`ewallet:auth:*${userId}*`),
    ]);

    console.log(`🔄 User cache invalidated for user ${userId}`);
    return results;
  } catch (error) {
    console.error(
      `❌ Error invalidating user cache for ${userId}:`,
      error.message
    );
    return [];
  }
};

// Test Redis connection
const testRedisConnection = async () => {
  try {
    console.log("Testing Redis connection...");
    await redis.set("test", "connection");
    const result = await redis.get("test");
    await redis.del("test");
    console.log("Redis connection successful!");
    return true;
  } catch (error) {
    console.error("Redis connection failed:", error.message);
    return false;
  }
};

module.exports = {
  redis,
  CACHE_TTL,
  getCacheKey,
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
  invalidateUserCache,
  testRedisConnection,
};
