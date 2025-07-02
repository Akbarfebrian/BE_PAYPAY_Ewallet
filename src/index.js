require("dotenv").config();
const express = require("express");
const {
  initializeConnections,
  setupGracefulShutdown,
} = require("./config/server");
const app = require("./config/app");

const PORT = process.env.PORT || 3001;

// Initialize connections and start server
const startServer = async () => {
  try {
    // Test all connections
    await initializeConnections();

    // Start server
    const server = app.listen(PORT, () => {
      console.log(`E-wallet service running on port http://localhost:${PORT}`);
      console.log("🚀 OPTIMIZED: Balance and topup operations are now cache-free");
      console.log("📊 Real-time balance queries enabled");
      console.log("⚡ Faster callback processing");
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    });

    // Setup graceful shutdown
    setupGracefulShutdown(server);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

