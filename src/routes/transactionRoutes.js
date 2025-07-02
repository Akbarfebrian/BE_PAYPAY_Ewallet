const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimiter");
const {
  getTransactionHistory,
  getTransactionDetails,
} = require("../controllers/transactionController");

// Get transaction history with pagination
router.get("/", authenticateUser, apiLimiter, getTransactionHistory);

// Get transaction details by ID
router.get(
  "/:transactionId",
  authenticateUser,
  apiLimiter,
  getTransactionDetails
);

module.exports = router;
