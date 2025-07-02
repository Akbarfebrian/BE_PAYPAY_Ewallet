const { prisma } = require("../config/database");
const { xendit, disbursementService } = require("../config/xendit");
const { invalidateUserCache } = require("../utils/cache");

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

// Get Balance - NO CACHE (Direct database query for real-time balance)
const getBalance = async (req, res) => {
  try {
    console.log(`📊 Fetching real-time balance for user ${req.user.id}`);

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { balance: true },
    });

    const balanceData = {
      balance: user.balance,
      fetched_at: new Date().toISOString(),
      real_time: true,
    };

    console.log(`✅ Real-time balance fetched: ${user.balance}`);

    res.json({
      message: "Balance fetched successfully",
      data: balanceData,
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
};

// Top up - NO CACHE (Simplified for faster processing)
const topup = async (req, res) => {
  try {
    const { amount, paymentMethod } = req.body;
    const userId = req.user.id;

    console.log(`💰 Processing topup: ${amount} for user ${userId}`);

    if (!amount || !paymentMethod) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount < 10000) {
      return res.status(400).json({ error: "Minimum amount is 10,000" });
    }

    if (!xendit) {
      return res.status(503).json({ error: "Payment service not available" });
    }

    const referenceId = `topup-${userId}-${Date.now()}`;

    const callbackUrl = IS_DEVELOPMENT
      ? `${process.env.NGROK_URL}/api/xendit/callback`
      : `${process.env.PRODUCTION_URL}/api/xendit/callback`;

    console.log("Using callback URL:", callbackUrl);

    const xenditData = {
      reference_id: referenceId,
      currency: "IDR",
      amount: amount,
      checkout_method: "ONE_TIME_PAYMENT",
      channel_code: paymentMethod,
      channel_properties: {
        success_redirect_url:
          process.env.SUCCESS_REDIRECT_URL || "http://localhost:3001",
        failure_redirect_url:
          process.env.FAILURE_REDIRECT_URL || "http://localhost:3001/failure",
      },
      callback_url: callbackUrl,
      metadata: {
        userId: userId,
        paymentMethod: paymentMethod,
      },
    };

    const xenditResponse = await fetch(
      "https://api.xendit.co/ewallets/charges",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            process.env.XENDIT_SECRET_KEY + ":"
          ).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(xenditData),
      }
    );

    const xenditResult = await xenditResponse.json();

    if (!xenditResponse.ok) {
      throw new Error(xenditResult.message || "Xendit API error");
    }

    // Create transaction record immediately
    const transaction = await prisma.transaction.create({
      data: {
        userId: userId,
        type: "TOPUP",
        amount: amount,
        status: "PENDING",
        referenceId: referenceId,
        xenditPaymentRequestId: xenditResult.id,
        description: `Top up via ${paymentMethod}`,
      },
    });

    console.log(`✅ Transaction created: ${referenceId}`);

    let checkoutUrl = null;
    if (xenditResult.is_redirect_required && xenditResult.actions) {
      checkoutUrl =
        xenditResult.actions.desktop_web_checkout_url ||
        xenditResult.actions.mobile_web_checkout_url ||
        xenditResult.actions.mobile_deeplink_checkout_url;
    }

    const responseData = {
      success: true,
      data: {
        referenceId: referenceId,
        status: xenditResult.status,
        paymentId: xenditResult.id,
        checkoutUrl: checkoutUrl,
        isRedirectRequired: xenditResult.is_redirect_required || false,
        qrString: xenditResult.actions?.qr_checkout_string || null,
      },
    };

    res.json(responseData);
  } catch (error) {
    console.error("Top up error:", error);
    res.status(500).json({
      error: "Failed to process top up",
      details: error.message,
    });
  }
};

// Payment status check - NO CACHE (Real-time status)
const getTopupStatus = async (req, res) => {
  try {
    const { referenceId } = req.params;

    console.log(`🔍 Checking real-time status for: ${referenceId}`);

    // Direct database query - no cache
    const transaction = await prisma.transaction.findFirst({
      where: { referenceId: referenceId },
      include: { user: { select: { balance: true } } },
    });

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.userId !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const statusData = {
      status: transaction.status,
      amount: transaction.amount,
      referenceId: transaction.referenceId,
      currentBalance: transaction.user.balance,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      real_time: true,
    };

    console.log(`✅ Real-time status: ${transaction.status}`);

    res.json(statusData);
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({ error: "Failed to check payment status" });
  }
};

// Transfer with minimal cache invalidation
const transfer = async (req, res) => {
  try {
    const { recipientPhoneNumber, amount, description } = req.body;

    if (!recipientPhoneNumber || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const sender = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!sender) {
      return res.status(404).json({ error: "Sender not found" });
    }

    const recipient = await prisma.user.findFirst({
      where: { phoneNumber: recipientPhoneNumber },
    });

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    if (sender.id === recipient.id) {
      return res.status(400).json({ error: "You cannot transfer to yourself" });
    }

    const fee = amount > 250000000 ? 10000 : 2500;
    const totalAmount = amount + fee;

    if (sender.balance < totalAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await prisma.$transaction(async (prismaTx) => {
      // Update sender's balance
      await prismaTx.user.update({
        where: { id: sender.id },
        data: {
          balance: { decrement: totalAmount },
        },
      });

      // Update recipient's balance
      await prismaTx.user.update({
        where: { id: recipient.id },
        data: {
          balance: { increment: amount },
        },
      });

      // Create fee transaction for sender
      await prismaTx.transaction.create({
        data: {
          userId: sender.id,
          type: "FEE",
          amount: fee,
          status: "COMPLETED",
          description: `Fee for transfer to ${recipient.phoneNumber}`,
        },
      });

      // Create transfer transaction for sender (OUTGOING)
      await prismaTx.transaction.create({
        data: {
          userId: sender.id,
          recipientId: recipient.id,
          type: "TRANSFER",
          amount: -amount, // Negative amount for outgoing
          status: "COMPLETED",
          description: description || `Transfer to ${recipient.phoneNumber}`,
        },
      });

      // Create transfer transaction for recipient (INCOMING)
      await prismaTx.transaction.create({
        data: {
          userId: recipient.id,
          recipientId: sender.id, // Using recipientId to store sender's ID
          type: "TRANSFER",
          amount: amount, // Positive amount for incoming
          status: "COMPLETED",
          description: `Transfer from ${sender.phoneNumber}`,
        },
      });
    });

    // Only invalidate transaction cache
    await Promise.all([
      invalidateUserCache(sender.id),
      invalidateUserCache(recipient.id),
    ]);

    res.status(200).json({
      message: "Transfer completed successfully",
      data: {
        amount,
        fee,
        total: totalAmount,
        recipientName: recipient.name,
        recipientPhoneNumber: recipient.phoneNumber,
      },
    });
  } catch (error) {
    console.error("Transfer error:", error);
    res.status(500).json({ error: "Server error during transfer" });
  }
};

// Withdraw with minimal cache invalidation
const withdraw = async (req, res) => {
  try {
    const { amount, bankCode, accountNumber, accountHolderName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    let fee;
    if (amount > 250000000) {
      fee = 10000;
    } else {
      fee = 2500;
    }

    const totalAmount = amount + fee;

    if (user.balance < totalAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const referenceId = `withdraw-${user.id}-${Date.now()}`;

    const disbursement = await disbursementService.create({
      externalID: referenceId,
      amount: amount,
      bankCode,
      accountHolderName,
      accountNumber,
      description: "E-wallet withdrawal",
    });

    await prisma.$transaction(async (prismaClient) => {
      await prismaClient.user.update({
        where: { id: user.id },
        data: {
          balance: {
            decrement: totalAmount,
          },
        },
      });

      await prismaClient.transaction.create({
        data: {
          userId: user.id,
          type: "WITHDRAW",
          amount: amount,
          status: "PENDING",
          referenceId: disbursement.id,
          description: `Withdrawal to ${bankCode} - ${accountNumber}`,
        },
      });

      await prismaClient.transaction.create({
        data: {
          userId: user.id,
          type: "FEE",
          amount: fee,
          status: "COMPLETED",
          description: "Fee for withdrawal",
        },
      });
    });

    // Only invalidate transaction cache
    await invalidateUserCache(user.id);

    res.status(200).json({
      message: "Withdrawal initiated successfully",
      data: {
        withdrawalId: disbursement.id,
        amount: amount,
        fee,
        total: totalAmount,
        status: "PENDING",
      },
    });
  } catch (error) {
    console.error("Withdrawal error:", error);
    res.status(500).json({ error: "Server error during withdrawal" });
  }
};

module.exports = {
  getBalance,
  topup,
  getTopupStatus,
  transfer,
  withdraw,
};