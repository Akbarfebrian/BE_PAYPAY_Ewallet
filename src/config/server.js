const { testXenditConnection } = require("./xendit");
const { testRedisConnection } = require("./redis");
const { testEmailConnection } = require("../utils/email_helper");

// Initialize connections
const initializeConnections = async () => {
  try {
    const [xenditSuccess, redisSuccess, emailSuccess] = await Promise.all([
      testXenditConnection(),
      testRedisConnection(),
      testEmailConnection(),
    ]);

    if (!xenditSuccess) {
      console.warn(
        "WARNING: Xendit integration may not be properly configured!"
      );
    }
    if (!redisSuccess) {
      console.warn("WARNING: Redis caching will not be available!");
    }
    if (!emailSuccess) {
      console.warn("WARNING: Email functionality may not be available!");
    }

    return { xenditSuccess, redisSuccess, emailSuccess };
  } catch (error) {
    console.error("Error initializing connections:", error);
    return { xenditSuccess: false, redisSuccess: false, emailSuccess: false };
  }
};

// Graceful shutdown
const setupGracefulShutdown = (server) => {
  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, shutting down...");
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
};

module.exports = {
  initializeConnections,
  setupGracefulShutdown,
};
