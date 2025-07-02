const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const {
  testAllConnections,
  clearCache,
  getSystemStats,
} = require("../controllers/debugController");

// Test all connections
router.get("/test-connections", authenticateUser, testAllConnections);

// Clear cache
router.post("/clear-cache", authenticateUser, clearCache);

// Get system stats
router.get("/stats", authenticateUser, getSystemStats);

module.exports = router;
