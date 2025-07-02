const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { authenticateUser } = require("../middleware/auth");

// Get Balance (authenticated)
router.get("/balance", authenticateUser, walletController.getBalance);

// Top up (authenticated)
router.post("/topup", authenticateUser, walletController.topup);

// Get topup status (authenticated)
router.get("/topup/status/:referenceId", authenticateUser, walletController.getTopupStatus);

// Transfer (authenticated)
router.post("/transfer", authenticateUser, walletController.transfer);

// Withdraw (authenticated)
router.post("/withdraw", authenticateUser, walletController.withdraw);

module.exports = router;