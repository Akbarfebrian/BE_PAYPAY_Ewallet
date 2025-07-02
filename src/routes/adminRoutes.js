const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const { apiLimiter } = require("../middleware/rateLimiter");
const {
  getAllUsers,
  getUserDetails,
  updateUserBalance,
} = require("../controllers/adminController");

// Get all users
router.get("/users", authenticateUser, apiLimiter, getAllUsers);

// Get user details
router.get("/users/:userId", authenticateUser, apiLimiter, getUserDetails);

// Update user balance
router.patch(
  "/users/:userId/balance",
  authenticateUser,
  apiLimiter,
  updateUserBalance
);

module.exports = router;
