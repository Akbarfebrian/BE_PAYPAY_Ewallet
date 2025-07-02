const {
  getCacheKey,
  setCache,
  getCache,
  deleteCache,
  CACHE_TTL,
} = require("../config/redis");
const { sendOTPEmail } = require("../utils/email_helper");

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const storeOTP = async (email, otp, type = "VERIFICATION") => {
  try {
    const otpKey = getCacheKey("otp", email, type);
    const rateLimitKey = getCacheKey("otp_rate_limit", email, type);

    // Check rate limit
    const rateLimitData = await getCache(rateLimitKey);
    let attempts = 0;
    let lastReset = new Date().toISOString();

    if (rateLimitData) {
      attempts = rateLimitData.attempts || 0;
      lastReset = rateLimitData.lastReset || lastReset;

      // Check if we're within the 2-hour window
      const lastResetDate = new Date(lastReset);
      const now = new Date();
      const hoursDiff = (now - lastResetDate) / (1000 * 60 * 60);

      if (hoursDiff < 2) {
        if (attempts >= 5) {
          throw new Error("Rate limit exceeded. Please try again later.");
        }
      } else {
        // Reset counter if 2 hours have passed
        attempts = 0;
        lastReset = now.toISOString();
      }
    }

    const otpData = {
      otp: otp.toString(),
      type,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    // Store OTP
    const success = await setCache(otpKey, otpData, CACHE_TTL.OTP);
    if (!success) {
      throw new Error("Failed to store OTP in cache");
    }

    // Update rate limit
    const newRateLimitData = {
      attempts: attempts + 1,
      lastReset,
    };
    await setCache(rateLimitKey, newRateLimitData, CACHE_TTL.OTP_RATE_LIMIT);

    console.log(`🔐 OTP stored for ${email} (Type: ${type})`);
    return otpKey;
  } catch (error) {
    console.error(`❌ Failed to store OTP for ${email}:`, error.message);
    throw error;
  }
};

const verifyOTP = async (email, inputOTP, type = "VERIFICATION") => {
  try {
    const otpKey = getCacheKey("otp", email, type);
    console.log(`🔍 Verifying OTP for key: ${otpKey}`);

    const otpData = await getCache(otpKey);

    if (!otpData) {
      console.log(`❌ OTP not found or expired for ${email}`);
      return { success: false, error: "OTP expired or not found" };
    }

    let parsedOTPData;
    if (typeof otpData === "string") {
      try {
        parsedOTPData = JSON.parse(otpData);
      } catch (e) {
        console.error(`❌ Failed to parse OTP data for ${email}:`, e.message);
        await deleteCache(otpKey);
        return { success: false, error: "Invalid OTP data format" };
      }
    } else {
      parsedOTPData = otpData;
    }

    if (!parsedOTPData || typeof parsedOTPData !== "object") {
      console.error(`❌ Invalid OTP data structure for ${email}`);
      await deleteCache(otpKey);
      return { success: false, error: "Invalid OTP data" };
    }

    const { otp: storedOTP, attempts = 0 } = parsedOTPData;

    if (attempts >= 5) {
      console.log(`❌ Too many attempts for ${email}`);
      await deleteCache(otpKey);
      return {
        success: false,
        error: "Too many attempts. Please request a new OTP.",
      };
    }

    const inputOTPStr = inputOTP.toString().trim();
    const storedOTPStr = storedOTP.toString().trim();

    if (inputOTPStr === storedOTPStr) {
      await deleteCache(otpKey);
      return { success: true };
    } else {
      // Update attempts
      parsedOTPData.attempts = attempts + 1;
      await setCache(otpKey, parsedOTPData, CACHE_TTL.OTP);
      return { success: false, error: "Invalid OTP" };
    }
  } catch (error) {
    console.error(`❌ OTP verification error for ${email}:`, error.message);
    return { success: false, error: "OTP verification failed" };
  }
};

const sendOTP = async (email, type = "VERIFICATION") => {
  try {
    const otp = generateOTP();
    await storeOTP(email, otp, type);
    await sendOTPEmail(email, otp);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send OTP to ${email}:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  generateOTP,
  storeOTP,
  verifyOTP,
  sendOTP,
};
