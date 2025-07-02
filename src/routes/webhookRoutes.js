const express = require("express");
const router = express.Router();
const { handleXenditCallback } = require("../controllers/webhookController");

// Xendit callback endpoint
router.post("/callback", handleXenditCallback);

module.exports = router;
