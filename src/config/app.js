const express = require("express");
const cors = require("cors");
const { authenticateUser } = require("../middleware/auth");
const userRoutes = require("../routes/userRoutes");
const transactionRoutes = require("../routes/transactionRoutes");
const webhookRoutes = require("../routes/webhookRoutes");
const adminRoutes = require("../routes/adminRoutes");
const debugRoutes = require("../routes/debugRoutes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/users", userRoutes);
app.use("/api/transactions", authenticateUser, transactionRoutes);
app.use("/api/xendit", webhookRoutes);
app.use("/api/admin", authenticateUser, adminRoutes);
app.use("/api/debug", authenticateUser, debugRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Something broke!",
  });
});

module.exports = app;
