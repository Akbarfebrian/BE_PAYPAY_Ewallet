const rateLimit = require("express-rate-limit");

const otpLimiter = rateLimit({
  windowMs: 2 * 60 * 60 * 1000, // 2 hours window
  max: 3, // limit each IP to 3 requests per windowMs
  message: { error: "Too many OTP requests, please try again after 2 hours" },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  otpLimiter,
  apiLimiter,
};
