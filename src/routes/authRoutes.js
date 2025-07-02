const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { otpLimiter } = require("../middleware/rateLimiter");
const { authenticateUser } = require("../middleware/auth");

// Register new user with OTP
router.post("/register", authController.register);

// Verify OTP
router.post("/verify-otp", otpLimiter, authController.verifyOtp);

// Resend OTP
router.post("/resend-otp", otpLimiter, authController.resendOtp);

// Login
router.post("/login", authController.login);

// Forgot Password
router.post("/forgot-password", otpLimiter, authController.forgotPassword);

// Reset Password
router.post("/reset-password", otpLimiter, authController.resetPassword);

// Change Password (authenticated)
router.post("/change-password", authenticateUser, authController.changePassword);

module.exports = router;