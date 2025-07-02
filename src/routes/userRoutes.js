const express = require("express");
const router = express.Router();
const { authenticateUser } = require("../middleware/auth");
const { getBalance } = require("../controllers/userController");

// Get user balance - requires authentication
router.get("/balance", authenticateUser, getBalance);

module.exports = router;
