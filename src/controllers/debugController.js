const { testConnections } = require("../services/connectionTest");
const { redis } = require("../config/redis");
const { prisma } = require("../config/database");

const testAllConnections = async (req, res) => {
  try {
    const [xenditSuccess, redisSuccess, emailSuccess] = await testConnections();

    res.json({
      success: true,
      connections: {
        xendit: xenditSuccess,
        redis: redisSuccess,
        email: emailSuccess,
      },
    });
  } catch (error) {
    console.error("Error testing connections:", error);
    res.status(500).json({ error: "Failed to test connections" });
  }
};

const clearCache = async (req, res) => {
  try {
    const keys = await redis.keys("ewallet:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    res.json({
      success: true,
      message: `Cleared ${keys.length} cache entries`,
    });
  } catch (error) {
    console.error("Error clearing cache:", error);
    res.status(500).json({ error: "Failed to clear cache" });
  }
};

const getSystemStats = async (req, res) => {
  try {
    const [userCount, transactionCount] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
    ]);

    const cacheKeys = await redis.keys("ewallet:*");
    const cacheStats = {
      totalKeys: cacheKeys.length,
      byType: cacheKeys.reduce((acc, key) => {
        const type = key.split(":")[1];
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({
      success: true,
      stats: {
        users: userCount,
        transactions: transactionCount,
        cache: cacheStats,
      },
    });
  } catch (error) {
    console.error("Error getting system stats:", error);
    res.status(500).json({ error: "Failed to get system stats" });
  }
};

module.exports = {
  testAllConnections,
  clearCache,
  getSystemStats,
};
