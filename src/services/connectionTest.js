require("dotenv").config();
const { redis } = require("../config/redis");
const { sendOTPEmail } = require("../utils/email_helper");


const testXenditConnection = async () => {
  console.warn("⚠️  Xendit not used, skipping connection test.");
  return false;
};

const testRedisConnection = async () => {
  try {
    await redis.ping();
    console.log("✅ Redis connection successful");
    return true;
  } catch (error) {
    console.error("❌ Redis connection test failed:", error.message);
    return false;
  }
};

const testEmailConnection = async () => {
  try {
    const testEmail = process.env.EMAIL_USER || "test@example.com";
    await sendOTPEmail(testEmail, "123456");
    console.log("✅ Email connection successful");
    return true;
  } catch (error) {
    console.error("❌ Email connection test failed:", error.message);
    return false;
  }
};

const testConnections = async () => {
  const [_, redisSuccess, emailSuccess] = await Promise.all([
    testXenditConnection(),
    testRedisConnection(),
    testEmailConnection(),
  ]);

  return [redisSuccess, emailSuccess];
};

module.exports = {
  testConnections,
  testRedisConnection,
  testEmailConnection,
};
