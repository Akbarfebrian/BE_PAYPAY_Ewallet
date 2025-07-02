const { Xendit } = require("xendit-node");

let xendit, disbursementService, eWalletService;

try {
  if (process.env.XENDIT_SECRET_KEY) {
    xendit = new Xendit({
      secretKey: process.env.XENDIT_SECRET_KEY,
    });

    const { Disbursement, EWallet } = xendit;
    disbursementService = new Disbursement({});
    eWalletService = new EWallet({});

    console.log("✅ Xendit initialized successfully");
  } else {
    console.warn("⚠️  Xendit not configured - XENDIT_SECRET_KEY missing");
  }
} catch (error) {
  console.error("❌ Failed to initialize Xendit:", error.message);
}

// Test Xendit connection
const testXenditConnection = async () => {
  try {
    console.log("Testing Xendit connection...");
    // Test with a simple API call instead of getPaymentMethods
    const response = await fetch(
      "https://api.xendit.co/available_disbursements_banks",
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            process.env.XENDIT_SECRET_KEY + ":"
          ).toString("base64")}`,
        },
      }
    );

    if (response.ok) {
      console.log("Xendit connection successful!");
      return true;
    } else {
      throw new Error("Xendit API test failed");
    }
  } catch (error) {
    console.error("❌ Xendit connection test failed:", error.message);
    return false;
  }
};

module.exports = {
  xendit,
  disbursementService,
  eWalletService,
  testXenditConnection,
};
