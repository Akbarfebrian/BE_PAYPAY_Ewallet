const { prisma } = require("../config/database");

const getBalance = async (req, res) => {
  try {
    console.log(`📊 Fetching real-time balance for user ${req.user.id}`);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { balance: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const balanceData = {
      balance: user.balance,
      fetched_at: new Date().toISOString(),
      real_time: true,
    };

    console.log(`✅ Real-time balance fetched: ${user.balance}`);

    res.json({
      success: true,
      message: "Balance fetched successfully",
      data: balanceData,
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch balance",
    });
  }
};

module.exports = {
  getBalance,
};
