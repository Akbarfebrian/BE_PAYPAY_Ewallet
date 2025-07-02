// File: server.js (OPTIMIZED - NO CACHE FOR TOPUP/BALANCE)
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { Redis } = require("@upstash/redis");
const { sendOTPEmail } = require("./src/utils/email_helper");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Rate limiter configuration
const otpLimiter = rateLimit({
  windowMs: 2 * 60 * 60 * 1000, // 2 hours window
  max: 3, // limit each IP to 5 requests per windowMs
  message: { error: "Too many OTP requests, please try again after 2 hours" },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Initialize Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Cache configuration (reduced TTL for remaining cached items)
const CACHE_TTL = {
  TRANSACTIONS: 30, // Reduced from 60
  USER_DATA: 180, // Reduced from 300
  OTP: 300, // 5 minutes for OTP validity
  OTP_RATE_LIMIT: 7200, // 2 hours for rate limiting
};

// Cache helper functions (kept for non-critical operations)
const getCacheKey = (type, userId, extra = "") => {
  return `ewallet:${type}:${userId}${extra ? `:${extra}` : ""}`;
};

const setCache = async (key, data, ttl = 60) => {
  try {
    let serializedData;
    if (typeof data === "string") {
      serializedData = data;
    } else if (typeof data === "object" && data !== null) {
      serializedData = JSON.stringify(data);
    } else {
      serializedData = String(data);
    }

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
      console.log(`⚠️  Cache data is not JSON, returning as string: ${key}`);
      return cached;
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

// Simplified cache invalidation (only for transactions now)
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

// Helper functions
function generateToken() {
  return require("crypto").randomBytes(32).toString("hex");
}

// OTP helper functions (keeping cache for OTP as it's security-related)
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

    if (inputOTPStr !== storedOTPStr) {
      console.log(
        `❌ Invalid OTP for ${email}. Expected: ${storedOTPStr}, Got: ${inputOTPStr}`
      );

      const updatedOTPData = {
        ...parsedOTPData,
        attempts: attempts + 1,
      };

      await setCache(otpKey, updatedOTPData, CACHE_TTL.OTP);

      return {
        success: false,
        error: `Invalid OTP. ${5 - (attempts + 1)} attempts remaining.`,
      };
    }

    console.log(`✅ OTP verified successfully for ${email}`);
    await deleteCache(otpKey);
    return { success: true };
  } catch (error) {
    console.error(`❌ Error verifying OTP for ${email}:`, error.message);
    return { success: false, error: "Server error during OTP verification" };
  }
};

app.use(cors());
app.use(express.json());

// Initialize Xendit
let xendit, disbursementService, eWalletService;

try {
  if (process.env.XENDIT_SECRET_KEY) {
    const Xendit = require("xendit-node");
    xendit = new Xendit({
      secretKey: process.env.XENDIT_SECRET_KEY,
    });

    const { Disbursement, EWallet } = xendit;
    disbursementService = new Disbursement({});
    eWalletService = new EWallet({});

    console.log("✅ Xendit initialized successfully");
  } else {
    console.warn("⚠️  Xendit not configured - XENDIT_SECRET_KEY missing");
  }
} catch (error) {
  console.error("❌ Failed to initialize Xendit:", error.message);
}

// Simplified authentication middleware (with minimal caching)
const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Token required" });
    }

    // Direct database query - no caching for auth
    const user = await prisma.user.findUnique({
      where: { token },
    });

    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        error: "Account not verified. Please verify your email first.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({ error: "Server error during authentication" });
  }
};

// Register new user with OTP
app.post("/api/users/register", async (req, res) => {
  try {
    const { name, email, password, phoneNumber } = req.body;

    if (!name || !email || !password || !phoneNumber) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const existingPhone = await prisma.user.findFirst({
      where: { phoneNumber },
    });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone number already exists" });
    }

    const otp = generateOTP();
    console.log(`Generated OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, "VERIFICATION");
      await sendOTPEmail(email, otp, "VERIFICATION");
    } catch (emailError) {
      console.error("Email sending error:", emailError);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        token: generateToken(),
        balance: 0,
        isVerified: false,
      },
    });

    res.status(201).json({
      message:
        "User registered successfully. Check email for OTP verification.",
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        needsVerification: true,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      error: "Registration failed",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Verify OTP
app.post("/api/users/verify-otp", otpLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const otpResult = await verifyOTP(email, otp, "VERIFICATION");
    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.error });
    }

    const updatedUser = await prisma.user.update({
      where: { email },
      data: { isVerified: true },
    });

    res.json({
      message: "Account verified successfully",
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        token: updatedUser.token,
        phoneNumber: updatedUser.phoneNumber,
        isVerified: true,
      },
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// Resend OTP
app.post("/api/users/resend-otp", otpLimiter, async (req, res) => {
  try {
    const { email, type = "VERIFICATION" } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (type === "VERIFICATION" && user.isVerified) {
      return res.status(400).json({ error: "Account already verified" });
    }

    const otp = generateOTP();
    console.log(`Resent OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, type);
      await sendOTPEmail(email, otp, type);
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      return res.status(500).json({ error: "Failed to send OTP email" });
    }

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// Login
app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        error: "Account not verified",
        needsVerification: true,
        email,
      });
    }

    res.json({
      message: "Login successful",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        token: user.token,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Forgot Password
app.post("/api/users/forgot-password", otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateOTP();
    console.log(`Password reset OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, "PASSWORD_RESET");
      await sendOTPEmail(email, otp, "PASSWORD_RESET");
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      return res.status(500).json({ error: "Failed to send reset email" });
    }

    res.json({ message: "Password reset OTP sent to your email" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to send reset OTP" });
  }
});

// Reset Password
app.post("/api/users/reset-password", otpLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ error: "Email, OTP, and new password are required" });
    }

    const otpResult = await verifyOTP(email, otp, "PASSWORD_RESET");
    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.error });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Password reset failed" });
  }
});

// Change Password
app.post("/api/users/change-password", authenticateUser, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Old and new passwords are required" });
    }

    const isOldPasswordValid = await bcrypt.compare(
      oldPassword,
      req.user.password
    );
    if (!isOldPasswordValid) {
      return res.status(401).json({ error: "Old password incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Password update failed" });
  }
});

// Get Balance - NO CACHE (Direct database query for real-time balance)
app.get("/api/users/balance", authenticateUser, async (req, res) => {
  try {
    console.log(`📊 Fetching real-time balance for user ${req.user.id}`);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { balance: true },
    });

    const balanceData = {
      balance: user.balance,
      fetched_at: new Date().toISOString(),
      real_time: true,
    };

    console.log(`✅ Real-time balance fetched: ${user.balance}`);

    res.json({
      message: "Balance fetched successfully",
      data: balanceData,
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

// Top up - NO CACHE (Simplified for faster processing)
app.post("/api/wallet/topup", authenticateUser, async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;
    const userId = req.user.id;

    console.log(`💰 Processing topup: ${amount} for user ${userId}`);

    if (!amount || !paymentMethod) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount < 10000) {
      return res.status(400).json({ error: "Minimum amount is 10,000" });
    }

    if (!xendit) {
      return res.status(503).json({ error: "Payment service not available" });
    }

    const referenceId = `topup-${userId}-${Date.now()}`;

    const callbackUrl = IS_DEVELOPMENT
      ? `${process.env.NGROK_URL}/api/xendit/callback`
      : `${process.env.PRODUCTION_URL}/api/xendit/callback`;

    console.log("Using callback URL:", callbackUrl);

    const xenditData = {
      reference_id: referenceId,
      currency: "IDR",
      amount: amount,
      checkout_method: "ONE_TIME_PAYMENT",
      channel_code: paymentMethod,
      channel_properties: {
        success_redirect_url:
          process.env.SUCCESS_REDIRECT_URL || "http://localhost:3001",
        failure_redirect_url:
          process.env.FAILURE_REDIRECT_URL || "http://localhost:3001/failure",
      },
      callback_url: callbackUrl,
      metadata: {
        userId: userId,
        paymentMethod: paymentMethod,
      },
    };

    const xenditResponse = await fetch(
      "https://api.xendit.co/ewallets/charges",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            process.env.XENDIT_SECRET_KEY + ":"
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(xenditData),
      }
    );

    const xenditResult = await xenditResponse.json();

    if (!xenditResponse.ok) {
      throw new Error(xenditResult.message || "Xendit API error");
    }

    // Create transaction record immediately
    const transaction = await prisma.transaction.create({
      data: {
        userId: userId,
        type: "TOPUP",
        amount: amount,
        status: "PENDING",
        referenceId: referenceId,
        xenditPaymentRequestId: xenditResult.id,
        description: `Top up via ${paymentMethod}`,
      },
    });

    console.log(`✅ Transaction created: ${referenceId}`);

    let checkoutUrl = null;
    if (xenditResult.is_redirect_required && xenditResult.actions) {
      checkoutUrl =
        xenditResult.actions.desktop_web_checkout_url ||
        xenditResult.actions.mobile_web_checkout_url ||
        xenditResult.actions.mobile_deeplink_checkout_url;
    }

    const responseData = {
      success: true,
      data: {
        referenceId: referenceId,
        status: xenditResult.status,
        paymentId: xenditResult.id,
        checkoutUrl: checkoutUrl,
        isRedirectRequired: xenditResult.is_redirect_required || false,
        qrString: xenditResult.actions?.qr_checkout_string || null,
      },
    };

    res.json(responseData);
  } catch (error) {
    console.error("Top up error:", error);
    res.status(500).json({
      error: "Failed to process top up",
      details: error.message,
    });
  }
});

// OPTIMIZED Webhook Callback - NO CACHE (Direct database operations for speed)
app.post("/api/xendit/callback", async (req, res) => {
  try {
    console.log("=== XENDIT CALLBACK RECEIVED ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Body:", JSON.stringify(req.body, null, 2));

    const { event, data, id, status, reference_id, metadata } = req.body;

    const transactionReferenceId =
      reference_id || data?.reference_id || data?.id;
    const transactionStatus =
      status ||
      data?.status ||
      (event === "ewallet.payment.succeeded"
        ? "SUCCEEDED"
        : event === "ewallet.payment.failed"
        ? "FAILED"
        : "PENDING");

    if (!transactionReferenceId) {
      console.error("❌ Missing reference_id in callback");
      return res.status(400).json({ error: "Missing reference_id" });
    }

    console.log(`🔍 Processing callback for: ${transactionReferenceId}`);

    // Direct database query - no cache
    const transaction = await prisma.transaction.findFirst({
      where: { referenceId: transactionReferenceId },
      include: { user: true },
    });

    if (!transaction) {
      console.error(`❌ Transaction not found: ${transactionReferenceId}`);
      return res.status(404).json({ error: "Transaction not found" });
    }

    let mappedStatus = "PENDING";
    if (
      transactionStatus === "SUCCEEDED" ||
      transactionStatus === "COMPLETED" ||
      event === "ewallet.payment.succeeded"
    ) {
      mappedStatus = "COMPLETED";
    } else if (
      transactionStatus === "FAILED" ||
      transactionStatus === "CANCELLED" ||
      event === "ewallet.payment.failed"
    ) {
      mappedStatus = "FAILED";
    }

    console.log(`📊 Status mapping: ${transactionStatus} -> ${mappedStatus}`);

    // Direct database update - no cache
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: mappedStatus, updatedAt: new Date() },
    });

    let updatedUser = null;
    if (mappedStatus === "COMPLETED") {
      console.log(`💰 Updating balance for user ${transaction.userId}`);

      // Direct balance update - no cache
      updatedUser = await prisma.user.update({
        where: { id: transaction.userId },
        data: { balance: { increment: transaction.amount } },
      });

      console.log(`✅ SUCCESS: User ${transaction.userId} balance updated!`);
      console.log(`💵 New balance: ${updatedUser.balance}`);
      console.log(`📈 Amount added: ${transaction.amount}`);
    }

    const response = {
      received: true,
      reference_id: transactionReferenceId,
      status: mappedStatus,
      transaction_id: transaction.id,
      user_balance: updatedUser
        ? updatedUser.balance
        : transaction.user.balance,
      processed_at: new Date().toISOString(),
    };

    console.log("=== CALLBACK PROCESSED SUCCESSFULLY ===");
    res.status(200).json(response);
  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error);
    res.status(500).json({
      error: "Webhook processing failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Payment status check - NO CACHE (Real-time status)
app.get(
  "/api/wallet/topup/status/:referenceId",
  authenticateUser,
  async (req, res) => {
    try {
      const { referenceId } = req.params;

      console.log(`🔍 Checking real-time status for: ${referenceId}`);

      // Direct database query - no cache
      const transaction = await prisma.transaction.findFirst({
        where: { referenceId: referenceId },
        include: { user: { select: { balance: true } } },
      });

      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      if (transaction.userId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const statusData = {
        status: transaction.status,
        amount: transaction.amount,
        referenceId: transaction.referenceId,
        currentBalance: transaction.user.balance,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        real_time: true,
      };

      console.log(`✅ Real-time status: ${transaction.status}`);

      res.json(statusData);
    } catch (error) {
      console.error("Status check error:", error);
      res.status(500).json({ error: "Failed to check payment status" });
    }
  }
);

// Transfer with minimal cache invalidation
app.post("/api/wallet/transfer", authenticateUser, async (req, res) => {
  try {
    const { recipientPhoneNumber, amount, description } = req.body;

    if (!recipientPhoneNumber || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const sender = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!sender) {
      return res.status(404).json({ error: "Sender not found" });
    }

    const recipient = await prisma.user.findFirst({
      where: { phoneNumber: recipientPhoneNumber },
    });

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    if (sender.id === recipient.id) {
      return res.status(400).json({ error: "You cannot transfer to yourself" });
    }

    const fee = amount > 250000000 ? 10000 : 2500;
    const totalAmount = amount + fee;

    if (sender.balance < totalAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await prisma.$transaction(async (prismaTx) => {
      // Update sender's balance
      await prismaTx.user.update({
        where: { id: sender.id },
        data: {
          balance: { decrement: totalAmount },
        },
      });

      // Update recipient's balance
      await prismaTx.user.update({
        where: { id: recipient.id },
        data: {
          balance: { increment: amount },
        },
      });

      // Create fee transaction for sender
      await prismaTx.transaction.create({
        data: {
          userId: sender.id,
          type: "FEE",
          amount: fee,
          status: "COMPLETED",
          description: `Fee for transfer to ${recipient.phoneNumber}`,
        },
      });

      // Create transfer transaction for sender (OUTGOING)
      await prismaTx.transaction.create({
        data: {
          userId: sender.id,
          recipientId: recipient.id,
          type: "TRANSFER",
          amount: -amount, // Negative amount for outgoing
          status: "COMPLETED",
          description: description || `Transfer to ${recipient.phoneNumber}`,
        },
      });

      // Create transfer transaction for recipient (INCOMING)
      await prismaTx.transaction.create({
        data: {
          userId: recipient.id,
          recipientId: sender.id, // Using recipientId to store sender's ID
          type: "TRANSFER",
          amount: amount, // Positive amount for incoming
          status: "COMPLETED",
          description: `Transfer from ${sender.phoneNumber}`,
        },
      });
    });

    // Only invalidate transaction cache
    await Promise.all([
      invalidateUserCache(sender.id),
      invalidateUserCache(recipient.id),
    ]);

    res.status(200).json({
      message: "Transfer completed successfully",
      data: {
        amount,
        fee,
        total: totalAmount,
        recipientName: recipient.name,
        recipientPhoneNumber: recipient.phoneNumber,
      },
    });
  } catch (error) {
    console.error("Transfer error:", error);
    res.status(500).json({ error: "Server error during transfer" });
  }
});

// Get transaction history with light caching
app.get("/api/transactions", authenticateUser, async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    const skip = (page - 1) * limit;

    // Create cache key based on query parameters
    const cacheKey = getCacheKey(
      "transactions",
      req.user.id,
      `${page}-${limit}-${type || "all"}`
    );
    let cachedData = await getCache(cacheKey);

    if (!cachedData) {
      const where = {
        userId: req.user.id,
      };

      if (type) {
        where.type = type;
      }

      const transactions = await prisma.transaction.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: Number(limit),
      });

      const total = await prisma.transaction.count({ where });

      cachedData = {
        transactions,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / limit),
        },
        cached_at: new Date().toISOString(),
      };

      await setCache(cacheKey, cachedData, CACHE_TTL.TRANSACTIONS);
    }

    res.status(200).json({
      message: "Transactions fetched successfully",
      data: cachedData,
    });
  } catch (error) {
    console.error("Transaction history error:", error);
    res.status(500).json({ error: "Server error while fetching transactions" });
  }
});

// Withdraw with minimal cache invalidation
app.post("/api/wallet/withdraw", authenticateUser, async (req, res) => {
  try {
    const { amount, bankCode, accountNumber, accountHolderName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    let fee;
    if (amount > 250000000) {
      fee = 10000;
    } else {
      fee = 2500;
    }

    const totalAmount = amount + fee;

    if (user.balance < totalAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const referenceId = `withdraw-${user.id}-${Date.now()}`;

    const disbursement = await disbursementService.create({
      externalID: referenceId,
      amount: amount,
      bankCode,
      accountHolderName,
      accountNumber,
      description: "E-wallet withdrawal",
    });

    await prisma.$transaction(async (prismaClient) => {
      await prismaClient.user.update({
        where: { id: user.id },
        data: {
          balance: {
            decrement: totalAmount,
          },
        },
      });

      await prismaClient.transaction.create({
        data: {
          userId: user.id,
          type: "WITHDRAW",
          amount: amount,
          status: "PENDING",
          referenceId: disbursement.id,
          description: `Withdrawal to ${bankCode} - ${accountNumber}`,
        },
      });

      await prismaClient.transaction.create({
        data: {
          userId: user.id,
          type: "FEE",
          amount: fee,
          status: "COMPLETED",
          description: "Fee for withdrawal",
        },
      });
    });

    // Only invalidate transaction cache
    await invalidateUserCache(user.id);

    res.status(200).json({
      message: "Withdrawal initiated successfully",
      data: {
        withdrawalId: disbursement.id,
        amount: amount,
        fee,
        total: totalAmount,
        status: "PENDING",
      },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.status(500).json({ error: "Server error during withdrawal" });
  }
});

// Admin fee withdrawal
app.post("/api/admin/withdraw-fees", authenticateUser, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await prisma.$queryRaw`
      SELECT SUM(amount) as totalFees 
      FROM "Transaction" 
      WHERE type = 'FEE' AND status = 'COMPLETED' AND adminWithdrawn = false
    `;

    const totalFees = result?.totalFees || 0;

    if (totalFees <= 0) {
      return res.status(400).json({ error: "No fees available to withdraw" });
    }

    const { bankCode, accountNumber, accountHolderName } = req.body;

    const disbursement = await disbursementService.create({
      externalID: `admin-fee-${Date.now()}`,
      amount: totalFees,
      bankCode,
      accountHolderName,
      accountNumber,
      description: "Admin fee withdrawal",
    });

    await prisma.transaction.updateMany({
      where: {
        type: "FEE",
        status: "COMPLETED",
        adminWithdrawn: false,
      },
      data: {
        adminWithdrawn: true,
      },
    });

    res.status(200).json({
      message: "Admin fees withdrawal initiated successfully",
      data: {
        withdrawalId: disbursement.id,
        amount: totalFees,
        status: "PENDING",
      },
    });
  } catch (error) {
    console.error("Admin fee withdrawal error:", error);
    res.status(500).json({ error: "Server error during admin fee withdrawal" });
  }
});

// Debug endpoint
app.get(
  "/api/debug/transaction/:referenceId",
  authenticateUser,
  async (req, res) => {
    try {
      const { referenceId } = req.params;

      const transaction = await prisma.transaction.findFirst({
        where: { referenceId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              balance: true,
            },
          },
        },
      });

      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      res.json({
        transaction,
        debug_info: {
          current_time: new Date().toISOString(),
          callback_url_used: IS_DEVELOPMENT
            ? `${process.env.NGROK_URL}/api/xendit/callback`
            : `${process.env.PRODUCTION_URL}/api/xendit/callback`,
          cache_disabled: "Balance and topup cache disabled for speed",
        },
      });
    } catch (error) {
      console.error("Debug endpoint error:", error);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// Simplified cache status endpoint
app.get("/api/debug/cache-status", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKeys = [getCacheKey("transactions", userId, "1-10-all")];

    const cacheStatus = {};
    for (const key of cacheKeys) {
      const value = await getCache(key);
      cacheStatus[key] = value ? "HIT" : "MISS";
    }

    res.json({
      cache_status: cacheStatus,
      redis_connected: true,
      optimization_note:
        "Balance and topup operations now cache-free for speed",
    });
  } catch (error) {
    res.status(500).json({
      error: "Cache status check failed",
      redis_connected: false,
    });
  }
});

// OTP debug endpoint (development only)
app.get("/api/debug/otp-status/:email", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const { email } = req.params;
    const { type = "VERIFICATION" } = req.query;

    const otpKey = getCacheKey("otp", email, type);
    const otpData = await getCache(otpKey);

    res.json({
      email,
      type,
      hasOTP: !!otpData,
      otpData: otpData || null,
      debug_warning: "This endpoint is only available in development mode",
    });
  } catch (error) {
    console.error("OTP debug error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Test Xendit connection
const testXenditConnection = async () => {
  try {
    console.log("Testing Xendit connection...");
    const eWalletTypes = await xendit.EWallet();
    console.log("Available e-wallet types:", eWalletTypes);
    console.log("Xendit connection successful!");
    return true;
  } catch (error) {
    console.error("Xendit connection failed:", error.message);
    return false;
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

// Test email connection
const testEmailConnection = async () => {
  try {
    console.log("Testing email connection...");
    const { sendOTPEmail } = require("./src/utils/email_helper");
    console.log("Email helper loaded successfully!");
    return true;
  } catch (error) {
    console.error("Email connection failed:", error.message);
    return false;
  }
};

// Helper functions
function generateToken() {
  return require("crypto").randomBytes(32).toString("hex");
}

function hashPassword(password) {
  return require("crypto").createHash("sha256").update(password).digest("hex");
}

// Initialize connections
Promise.all([
  testXenditConnection(),
  testRedisConnection(),
  testEmailConnection(),
]).then(([xenditSuccess, redisSuccess, emailSuccess]) => {
  if (!xenditSuccess) {
    console.warn("WARNING: Xendit integration may not be properly configured!");
  }
  if (!redisSuccess) {
    console.warn("WARNING: Redis caching will not be available!");
  }
  if (!emailSuccess) {
    console.warn("WARNING: Email functionality may not be available!");
  }
});

app.listen(PORT, () => {
  console.log(`E-wallet service running on port http://localhost:${PORT}`);
  console.log(`🚀 OPTIMIZED: Balance and topup operations are now cache-free`);
  console.log(`📊 Real-time balance queries enabled`);
  console.log(`⚡ Faster callback processing`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});
