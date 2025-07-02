// src/utils/email_helper.js
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendOTPEmail = async (email, otp, type) => {
  let subject = "";
  let htmlContent = "";
  let title = "";
  let greeting = "";
  let message = "";
  let otpLabel = "";

  switch (type) {
    case "VERIFICATION":
      subject = "Verify Your Email Address to Complete Registration";
      title = "Welcome to PAY-PAY E-Wallet APP!";
      greeting =
        "Thank you for signing up with PAY-PAY E-Wallet APP! We're thrilled to have you on board.";
      message =
        "To ensure the security of your account and access all the features, please use the following OTP to verify your email address:";
      otpLabel = "Verification Code";
      break;
    case "PASSWORD_RESET":
      subject = "Reset Your Password - PAY-PAY";
      title = "Password Reset Request";
      greeting =
        "We received a request to reset your password for your PAY-PAY account.";
      message =
        "Please use the following OTP to reset your password. This code is valid for 5 minutes:";
      otpLabel = "Reset Code";
      break;
    case "LOGIN":
      subject = "Login Verification - PAY-PAY";
      title = "Login Verification";
      greeting = "Someone is trying to log into your PAY-PAY account.";
      message =
        "If this was you, please use the following OTP to complete your login. This code is valid for 5 minutes:";
      otpLabel = "Login Code";
      break;
    default:
      subject = "OTP Code - PAY-PAY";
      title = "Verification Required";
      greeting =
        "You have requested a verification code for your PAY-PAY account.";
      message =
        "Please use the following OTP to complete your verification. This code is valid for 5 minutes:";
      otpLabel = "Verification Code";
  }

  htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #ffffff; padding: 40px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333333; margin: 0; font-size: 24px;">${title}</h1>
            </div>
            <!-- Content -->
            <div style="margin-bottom: 30px;">
              <p style="margin-bottom: 15px;">Hello,</p>
              <p style="margin-bottom: 15px;">${greeting}</p>
              <p style="margin-bottom: 15px;">${message}</p>
              
              <!-- OTP Box -->
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; text-align: center; margin: 25px 0;">
                <p style="margin-bottom: 10px; color: #666666; font-size: 14px; font-weight: bold;">${otpLabel}</p>
                <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #007bff;">
                  ${otp}
                </span>
              </div>
              
              ${
                type === "VERIFICATION"
                  ? "<p style=\"margin-bottom: 15px;\">Once your email is verified, you'll be ready to dive into PAY-PAY's exciting features.</p>"
                  : '<p style="margin-bottom: 15px;">If you did not request this, please contact our support team immediately.</p>'
              }
              
              <p style="margin-bottom: 15px;">If you did not request this action, please ignore this email or contact our support team at <a href="mailto:akbarfebrian080@gmail.com" style="color: #007bff; text-decoration: none;">akbarfebrian080@gmail.com</a>.</p>
            </div>
            <!-- Footer -->
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eeeeee;">
              <p style="margin-bottom: 10px;">Thank you for choosing PAY-PAY!</p>
              <p style="margin: 0; color: #666666;">Best regards,<br>PAY-PAY Team</p>
            </div>
          </div>
          <!-- Disclaimer -->
          <div style="text-align: center; margin-top: 20px; color: #999999; font-size: 12px;">
            <p>This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"akbarfebrian080" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject,
    html: htmlContent,
  });
};

module.exports = {
  sendOTPEmail,
};
