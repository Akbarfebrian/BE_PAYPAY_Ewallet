const { prisma } = require("../config/database");

const authenticateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Token required",
      });
    }

    // Direct database query - no caching for auth
    const user = await prisma.user.findUnique({
      where: { token },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Invalid token",
      });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        error: "Account not verified. Please verify your email first.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      success: false,
      error: "Server error during authentication",
    });
  }
};

module.exports = {
  authenticateUser,
};
