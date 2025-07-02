const { prisma } = require("../config/database");
const { invalidateUserCache } = require("../config/redis");

const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        balance: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    });

    const total = await prisma.user.count();

    res.json({
      users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        balance: true,
        createdAt: true,
        updatedAt: true,
        transactions: {
          orderBy: {
            createdAt: "desc",
          },
          take: 10,
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
};

const updateUserBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, type } = req.body;

    if (!amount || !type || !["ADD", "SUBTRACT"].includes(type.toUpperCase())) {
      return res.status(400).json({
        error: "Invalid request. Amount and type (ADD/SUBTRACT) are required",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const newBalance =
      type.toUpperCase() === "ADD"
        ? user.balance + amount
        : user.balance - amount;

    if (newBalance < 0) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        balance: newBalance,
      },
    });

    // Invalidate user cache
    await invalidateUserCache(userId);

    res.json({
      success: true,
      message: `Balance ${type.toLowerCase()}ed successfully`,
      newBalance,
    });
  } catch (error) {
    console.error("Error updating user balance:", error);
    res.status(500).json({ error: "Failed to update user balance" });
  }
};

module.exports = {
  getAllUsers,
  getUserDetails,
  updateUserBalance,
};
