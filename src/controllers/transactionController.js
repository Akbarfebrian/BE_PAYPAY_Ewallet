const { prisma } = require("../config/database");
const { getCache, setCache, CACHE_TTL } = require("../config/redis");

const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const type = req.query.type; // Optional type filter

    // Create cache key based on query parameters
    const cacheKey = `ewallet:transactions:${userId}:${page}:${limit}:${
      type || "all"
    }`;
    const cachedData = await getCache(cacheKey);

    if (cachedData) {
      return res.json({
        success: true,
        data: cachedData,
      });
    }

    // Build where clause
    const where = {
      userId: userId,
    };

    // Add type filter if provided
    if (type) {
      where.type = type.toUpperCase();
    }

    // Get transactions with pagination
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
            },
          },
          recipient: {
            select: {
              id: true,
              name: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    // Transform transactions to match frontend types
    const transformedTransactions = transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      status: transaction.status,
      description: transaction.description,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      sender: transaction.user
        ? {
            id: transaction.user.id,
            name: transaction.user.name,
            email: transaction.user.email,
            phoneNumber: transaction.user.phoneNumber,
          }
        : null,
      recipient: transaction.recipient
        ? {
            id: transaction.recipient.id,
            name: transaction.recipient.name,
            email: transaction.recipient.email,
            phoneNumber: transaction.recipient.phoneNumber,
          }
        : null,
    }));

    const result = {
      transactions: transformedTransactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      cached_at: new Date().toISOString(),
    };

    // Cache the result
    await setCache(cacheKey, result, CACHE_TTL.TRANSACTIONS);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transaction history",
    });
  }
};

const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.id;

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: transactionId,
        userId: userId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneNumber: true,
          },
        },
        recipient: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneNumber: true,
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found",
      });
    }

    // Transform transaction to match frontend types
    const transformedTransaction = {
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      status: transaction.status,
      description: transaction.description,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      sender: transaction.user
        ? {
            id: transaction.user.id,
            name: transaction.user.name,
            email: transaction.user.email,
            phoneNumber: transaction.user.phoneNumber,
          }
        : null,
      recipient: transaction.recipient
        ? {
            id: transaction.recipient.id,
            name: transaction.recipient.name,
            email: transaction.recipient.email,
            phoneNumber: transaction.recipient.phoneNumber,
          }
        : null,
    };

    res.json({
      success: true,
      data: transformedTransaction,
    });
  } catch (error) {
    console.error("Error fetching transaction details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch transaction details",
    });
  }
};

module.exports = {
  getTransactionHistory,
  getTransactionDetails,
};
