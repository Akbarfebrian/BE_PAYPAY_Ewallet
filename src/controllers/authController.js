const bcrypt = require("bcryptjs");
const { prisma } = require("../config/database");
const { generateOTP, storeOTP, verifyOTP } = require("../services/otpService");
const { sendOTPEmail } = require("../utils/email_helper");
const { generateToken } = require("../utils/helpers");

// Register new user with OTP
const register = async (req, res) => {
  try {
    const { name, email, password, phoneNumber } = req.body;

    if (!name || !email || !password || !phoneNumber) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const existingPhone = await prisma.user.findFirst({
      where: { phoneNumber },
    });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone number already exists" });
    }

    const otp = generateOTP();
    console.log(`Generated OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, "VERIFICATION");
      await sendOTPEmail(email, otp, "VERIFICATION");
    } catch (emailError) {
      console.error("Email sending error:", emailError);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        token: generateToken(),
        balance: 0,
        isVerified: false,
      },
    });

    res.status(201).json({
      message:
        "User registered successfully. Check email for OTP verification.",
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        needsVerification: true,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      error: "Registration failed",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Verify OTP
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const otpResult = await verifyOTP(email, otp, "VERIFICATION");
    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.error });
    }

    const updatedUser = await prisma.user.update({
      where: { email },
      data: { isVerified: true },
    });

    res.json({
      message: "Account verified successfully",
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        token: updatedUser.token,
        phoneNumber: updatedUser.phoneNumber,
        isVerified: true,
      },
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
};

// Resend OTP
const resendOtp = async (req, res) => {
  try {
    const { email, type = "VERIFICATION" } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (type === "VERIFICATION" && user.isVerified) {
      return res.status(400).json({ error: "Account already verified" });
    }

    const otp = generateOTP();
    console.log(`Resent OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, type);
      await sendOTPEmail(email, otp, type);
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      return res.status(500).json({ error: "Failed to send OTP email" });
    }

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

// Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        error: "Account not verified",
        needsVerification: true,
        email,
      });
    }

    res.json({
      message: "Login successful",
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        token: user.token,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

// Forgot Password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateOTP();
    console.log(`Password reset OTP for ${email}: ${otp}`);

    try {
      await storeOTP(email, otp, "PASSWORD_RESET");
      await sendOTPEmail(email, otp, "PASSWORD_RESET");
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      return res.status(500).json({ error: "Failed to send reset email" });
    }

    res.json({ message: "Password reset OTP sent to your email" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to send reset OTP" });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ error: "Email, OTP, and new password are required" });
    }

    const otpResult = await verifyOTP(email, otp, "PASSWORD_RESET");
    if (!otpResult.success) {
      return res.status(400).json({ error: otpResult.error });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Password reset failed" });
  }
};

// Change Password
const changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Old and new passwords are required" });
    }

    const isOldPasswordValid = await bcrypt.compare(
      oldPassword,
      req.user.password
    );
    if (!isOldPasswordValid) {
      return res.status(401).json({ error: "Old password incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Password update failed" });
  }
};

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  login,
  forgotPassword,
  resetPassword,
  changePassword,
};