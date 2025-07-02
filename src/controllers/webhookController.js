const { prisma } = require("../config/database");
const { invalidateUserCache } = require("../config/redis");

const handleXenditCallback = async (req, res) => {
  try {
    const { external_id, status, paid_amount, paid_at } = req.body;

    if (!external_id || !status) {
      return res.status(400).json({ error: "Invalid callback data" });
    }

    // Find the transaction
    const transaction = await prisma.transaction.findFirst({
      where: {
        externalId: external_id,
      },
      include: {
        sender: true,
      },
    });

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Update transaction status
    await prisma.transaction.update({
      where: {
        id: transaction.id,
      },
      data: {
        status: status.toUpperCase(),
        paidAmount: paid_amount || transaction.amount,
        paidAt: paid_at ? new Date(paid_at) : null,
      },
    });

    // If payment is successful, update user balance
    if (status === "PAID") {
      await prisma.user.update({
        where: {
          id: transaction.senderId,
        },
        data: {
          balance: {
            increment: transaction.amount,
          },
        },
      });

      // Invalidate user cache
      await invalidateUserCache(transaction.senderId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error processing Xendit callback:", error);
    res.status(500).json({ error: "Failed to process callback" });
  }
};

module.exports = {
  handleXenditCallback,
};
