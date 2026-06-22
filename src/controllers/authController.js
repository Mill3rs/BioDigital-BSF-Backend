const bcrypt = require("bcryptjs");
const { prisma } = require("../config/database");
const {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const { AppError } = require("../middleware/errorHandler");
const logger = require("../utils/logger");
const emailService = require("../services/emailService");
const notificationService = require("../services/notificationService");
const { OAuth2Client } = require("google-auth-library");
const appleSigninAuth = require("apple-signin-auth");

class AuthController {
  // Register new user
  async register(req, res, next) {
    try {
      const {
        email,
        password,
        fullName,
        phoneNumber,
        role,
        supplierType,
        organizationName,
      } = req.body;

      if (!email && !phoneNumber) {
        throw new AppError("Email or phone number is required", 400);
      }

      // Check if phone auth is enabled when registering with phone only
      if (!email && phoneNumber) {
        const phoneAuthSetting = await prisma.systemSetting.findUnique({
          where: { key: "phone_auth_enabled" },
        });
        if (!phoneAuthSetting || phoneAuthSetting.value !== "true") {
          throw new AppError("Phone number registration is not enabled", 403);
        }
      }

      if (email) {
        const existingByEmail = await prisma.user.findUnique({
          where: { email },
        });
        if (existingByEmail)
          throw new AppError("Email already registered", 400);
      }
      if (phoneNumber) {
        const existingByPhone = await prisma.user.findFirst({
          where: { phoneNumber },
        });
        if (existingByPhone)
          throw new AppError("Phone number already registered", 400);
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email: email || null,
          password: hashedPassword,
          fullName,
          phoneNumber: phoneNumber || null,
          role,
          status: role === "DRIVER" ? "PENDING_VERIFICATION" : "ACTIVE",
          onboardingStep:
            role === "SUPPLIER" || role === "DRIVER"
              ? "PENDING_CODE"
              : "COMPLETE",
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          status: true,
          onboardingStep: true,
          createdAt: true,
        },
      });

      // Create role-specific profile
      if (role === "DRIVER") {
        await prisma.driverProfile.create({ data: { userId: user.id } });
      } else if (role === "BUYER") {
        await prisma.buyerProfile.create({ data: { userId: user.id } });
      } else if (role === "SUPPLIER") {
        await prisma.supplierProfile.create({
          data: {
            userId: user.id,
            primaryProducts: [],
            wasteTypes: [],
            supplierType: supplierType || "FARMER",
            organizationName: organizationName || null,
          },
        });
      }

      const token = generateToken(user.id, user.role);
      const refreshToken = generateRefreshToken(user.id);

      // Send verification email
      emailService
        .sendVerificationEmail(user.email, token)
        .catch((err) =>
          logger.error("Failed to send verification email:", err),
        );

      // Notify all admins/managers when a new supplier or driver registers
      if (role === "SUPPLIER" || role === "DRIVER") {
        const roleLabel = role === "SUPPLIER" ? "Supplier" : "Driver";
        const emoji = role === "SUPPLIER" ? "🧑‍🌾" : "🚚";
        notificationService
          .notifyAdminsAndManagers(
            null,
            `New ${roleLabel} Registration ${emoji}`,
            `${user.fullName} has registered as a ${roleLabel} and is awaiting approval. Please review their profile.`,
            "SYSTEM",
            { userId: user.id, userRole: role },
            "user:registered",
            { userId: user.id, fullName: user.fullName, role },
          )
          .catch((err) =>
            logger.error("Failed to notify admins of new registration:", err),
          );
      }

      res.status(201).json({
        success: true,
        message: "Registration successful",
        data: { token, refreshToken, user },
      });
    } catch (error) {
      next(error);
    }
  }

  // Login user
  async login(req, res, next) {
    try {
      const { identifier, password } = req.body;

      const isEmail = identifier.includes("@");

      const user = await prisma.user.findFirst({
        where: isEmail ? { email: identifier } : { phoneNumber: identifier },
        include: {
          farm: true,
          driverProfile: true,
          buyerProfile: true,
          supplierProfile: true,
        },
      });

      if (!user) {
        throw new AppError("Username/password is incorrect", 401);
      }

      // Phone auth setting only restricts BUYER accounts — staff can always use phone login
      if (!isEmail && user.role === "BUYER") {
        const phoneAuthSetting = await prisma.systemSetting.findUnique({
          where: { key: "phone_auth_enabled" },
        });
        if (!phoneAuthSetting || phoneAuthSetting.value !== "true") {
          throw new AppError("Phone number sign-in is not enabled", 403);
        }
      }

      if (!user.password) {
        throw new AppError(
          "This account uses Google Sign-In. Please sign in with Google.",
          401,
        );
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new AppError("Username/password is incorrect", 401);
      }

      if (user.status === "SUSPENDED") {
        throw new AppError("Account suspended. Please contact support.", 401);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      const token = generateToken(user.id, user.role);
      const refreshToken = generateRefreshToken(user.id);

      const { password: _, ...userData } = user;

      res.json({
        success: true,
        message: "Login successful",
        data: { token, refreshToken, user: userData },
      });
    } catch (error) {
      next(error);
    }
  }

  // Google Sign-In / Register
  async googleSignIn(req, res, next) {
    try {
      const { idToken, role } = req.body;
      if (!idToken) throw new AppError("Google ID token is required", 400);

      const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: [
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_WEB_CLIENT_ID,
          ].filter(Boolean),
        });
        payload = ticket.getPayload();
      } catch {
        throw new AppError("Invalid Google token", 401);
      }

      const { sub: googleId, email, name, picture } = payload;

      // Find existing user by googleId or matching email
      const userSelect = {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        googleId: true,
        profileImage: true,
        role: true,
        status: true,
        onboardingStep: true,
        createdAt: true,
        farm: true,
        driverProfile: true,
        buyerProfile: true,
        supplierProfile: true,
      };

      let user = await prisma.user.findFirst({
        where: { OR: [{ googleId }, ...(email ? [{ email }] : [])] },
        select: { ...userSelect, password: true },
      });

      if (user) {
        if (user.status === "SUSPENDED")
          throw new AppError("Account suspended. Please contact support.", 401);
        // Link googleId to existing email-based account if not yet linked
        if (!user.googleId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              googleId,
              profileImage: user.profileImage || picture || null,
            },
            select: { ...userSelect, password: true },
          });
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });
        const { password: _p, ...userData } = user;
        const token = generateToken(user.id, user.role);
        const refreshToken = generateRefreshToken(user.id);
        return res.json({
          success: true,
          message: "Login successful",
          data: { token, refreshToken, user: userData },
        });
      }

      // New user — role required (admin roles cannot self-register via Google)
      if (!role) {
        return res.status(400).json({
          success: false,
          error: "role_required",
          message: "Select your role to continue",
        });
      }
      const allowedRoles = ["BUYER", "SUPPLIER", "DRIVER"];
      if (!allowedRoles.includes(role)) {
        throw new AppError(
          "Invalid role. Must be BUYER, SUPPLIER, or DRIVER",
          400,
        );
      }

      const newUser = await prisma.user.create({
        data: {
          email: email || null,
          googleId,
          password: null,
          fullName: name,
          profileImage: picture || null,
          role,
          emailVerified: true,
          status: role === "DRIVER" ? "PENDING_VERIFICATION" : "ACTIVE",
          onboardingStep:
            role === "SUPPLIER" || role === "DRIVER"
              ? "PENDING_CODE"
              : "COMPLETE",
        },
        select: userSelect,
      });

      if (role === "DRIVER") {
        await prisma.driverProfile.create({ data: { userId: newUser.id } });
      } else if (role === "BUYER") {
        await prisma.buyerProfile.create({ data: { userId: newUser.id } });
      } else if (role === "SUPPLIER") {
        await prisma.supplierProfile.create({
          data: {
            userId: newUser.id,
            primaryProducts: [],
            wasteTypes: [],
            supplierType: "FARMER",
          },
        });
      }

      if (role === "SUPPLIER" || role === "DRIVER") {
        const roleLabel = role === "SUPPLIER" ? "Supplier" : "Driver";
        const emoji = role === "SUPPLIER" ? "🧑‍🌾" : "🚚";
        notificationService
          .notifyAdminsAndManagers(
            null,
            `New ${roleLabel} Registration ${emoji}`,
            `${newUser.fullName} has registered via Google as a ${roleLabel} and is awaiting approval.`,
            "SYSTEM",
            { userId: newUser.id, userRole: role },
            "user:registered",
            { userId: newUser.id, fullName: newUser.fullName, role },
          )
          .catch((err) =>
            logger.error(
              "Failed to notify admins of Google registration:",
              err,
            ),
          );
      }

      const token = generateToken(newUser.id, newUser.role);
      const refreshToken = generateRefreshToken(newUser.id);
      return res.status(201).json({
        success: true,
        message: "Registration successful",
        data: { token, refreshToken, user: newUser },
      });
    } catch (error) {
      next(error);
    }
  }

  // Apple Sign-In / Register
  async appleSignIn(req, res, next) {
    try {
      const { identityToken, user: appleUser, role } = req.body;
      if (!identityToken)
        throw new AppError("Apple identity token is required", 400);

      let applePayload;
      try {
        applePayload = await appleSigninAuth.verifyIdToken(identityToken, {
          audience: process.env.APPLE_CLIENT_ID,
          ignoreExpiration: false,
        });
      } catch {
        throw new AppError("Invalid Apple identity token", 401);
      }

      const appleId = applePayload.sub;
      const email = applePayload.email || null;
      // Apple sends the full name only on the first registration
      let appleName = applePayload.name || null;
      if (!appleName && appleUser?.name) {
        const { firstName, lastName } = appleUser.name;
        appleName = [firstName, lastName].filter(Boolean).join(" ");
      }

      const userSelect = {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        appleId: true,
        profileImage: true,
        role: true,
        status: true,
        onboardingStep: true,
        createdAt: true,
        farm: true,
        driverProfile: true,
        buyerProfile: true,
        supplierProfile: true,
      };

      let user = await prisma.user.findFirst({
        where: { OR: [{ appleId }, ...(email ? [{ email }] : [])] },
        select: { ...userSelect, password: true },
      });

      if (user) {
        if (user.status === "SUSPENDED")
          throw new AppError("Account suspended. Please contact support.", 401);
        // Link appleId to existing email-based account if not yet linked
        if (!user.appleId) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              appleId,
              fullName: user.fullName || appleName || "",
            },
            select: { ...userSelect, password: true },
          });
        }
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });
        const { password: _p, ...userData } = user;
        const token = generateToken(user.id, user.role);
        const refreshToken = generateRefreshToken(user.id);
        return res.json({
          success: true,
          message: "Login successful",
          data: { token, refreshToken, user: userData },
        });
      }

      // New user — role required (admin roles cannot self-register via Apple)
      if (!role) {
        return res.status(400).json({
          success: false,
          error: "role_required",
          message: "Select your role to continue",
        });
      }
      const allowedRoles = ["BUYER", "SUPPLIER", "DRIVER"];
      if (!allowedRoles.includes(role)) {
        throw new AppError(
          "Invalid role. Must be BUYER, SUPPLIER, or DRIVER",
          400,
        );
      }

      const newUser = await prisma.user.create({
        data: {
          email,
          appleId,
          password: null,
          fullName: appleName || "Apple User",
          role,
          emailVerified: true,
          status: role === "DRIVER" ? "PENDING_VERIFICATION" : "ACTIVE",
          onboardingStep:
            role === "SUPPLIER" || role === "DRIVER"
              ? "PENDING_CODE"
              : "COMPLETE",
        },
        select: userSelect,
      });

      if (role === "DRIVER") {
        await prisma.driverProfile.create({ data: { userId: newUser.id } });
      } else if (role === "BUYER") {
        await prisma.buyerProfile.create({ data: { userId: newUser.id } });
      } else if (role === "SUPPLIER") {
        await prisma.supplierProfile.create({
          data: {
            userId: newUser.id,
            primaryProducts: [],
            wasteTypes: [],
            supplierType: "FARMER",
          },
        });
      }

      if (role === "SUPPLIER" || role === "DRIVER") {
        const roleLabel = role === "SUPPLIER" ? "Supplier" : "Driver";
        const emoji = role === "SUPPLIER" ? "🧑‍🌾" : "🚚";
        notificationService
          .notifyAdminsAndManagers(
            null,
            `New ${roleLabel} Registration ${emoji}`,
            `${newUser.fullName} has registered via Apple as a ${roleLabel} and is awaiting approval.`,
            "SYSTEM",
            { userId: newUser.id, userRole: role },
            "user:registered",
            { userId: newUser.id, fullName: newUser.fullName, role },
          )
          .catch((err) =>
            logger.error("Failed to notify admins of Apple registration:", err),
          );
      }

      const token = generateToken(newUser.id, newUser.role);
      const refreshToken = generateRefreshToken(newUser.id);
      return res.status(201).json({
        success: true,
        message: "Registration successful",
        data: { token, refreshToken, user: newUser },
      });
    } catch (error) {
      next(error);
    }
  }

  // Refresh token
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new AppError("Refresh token required", 400);
      }

      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        throw new AppError("Invalid refresh token", 401);
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new AppError("User not found", 401);
      }

      const newToken = generateToken(user.id, user.role);
      const newRefreshToken = generateRefreshToken(user.id);

      res.json({
        success: true,
        data: { token: newToken, refreshToken: newRefreshToken },
      });
    } catch (error) {
      next(error);
    }
  }

  // Forgot password
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.json({
          success: true,
          message: "If email exists, reset link will be sent",
        });
      }

      const resetToken = generateToken(user.id, user.role);
      const resetUrl = `${process.env.API_URL}/api/auth/reset-password/${resetToken}`;

      logger.info(`Password reset link for ${email}: ${resetUrl}`);

      // Send password reset email
      emailService
        .sendPasswordResetEmail(email, resetToken)
        .catch((err) =>
          logger.error("Failed to send password reset email:", err),
        );

      res.json({
        success: true,
        message: "Password reset instructions sent to your email",
      });
    } catch (error) {
      next(error);
    }
  }

  // Reset password — GET: show HTML form
  async resetPasswordForm(req, res) {
    const { token } = req.params;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password — Biodigital BSF Farms</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1e10; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #0f2216; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 36px 28px; max-width: 400px; width: 100%; text-align: center; }
    h2 { font-size: 1.4rem; margin-bottom: 8px; color: #4ade80; }
    p { color: #94a3b8; font-size: .9rem; margin-bottom: 24px; }
    label { display: block; text-align: left; font-size: .85rem; color: #94a3b8; margin-bottom: 4px; }
    input { width: 100%; padding: 12px 14px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.04); color: #e2e8f0; font-size: .95rem; margin-bottom: 16px; }
    input:focus { outline: none; border-color: #4ade80; }
    button { width: 100%; padding: 12px; border: none; border-radius: 10px; background: #4ade80; color: #0b1e10; font-weight: 600; font-size: .95rem; cursor: pointer; transition: background .2s; }
    button:hover { background: #22c55e; }
    .error { color: #f87171; font-size: .85rem; margin-bottom: 12px; display: none; }
    .success { display: none; }
    .success h2 { margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div id="form">
      <h2>Reset Your Password</h2>
      <p>Choose a new password for your Biodigital BSF Farms account.</p>
      <label for="pw">New Password</label>
      <input type="password" id="pw" placeholder="Min. 6 characters" minlength="6" required>
      <label for="cpw">Confirm Password</label>
      <input type="password" id="cpw" placeholder="Re-enter password" minlength="6" required>
      <div class="error" id="err"></div>
      <button>Reset Password</button>
    </div>
    <div class="success" id="ok">
      <h2>✅ Password Updated!</h2>
      <p>Your password has been changed. You can now sign in to the app.</p>
    </div>
  </div>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    document.querySelector('button').addEventListener('click', async function reset() {
      const pw = document.getElementById('pw').value;
      const cpw = document.getElementById('cpw').value;
      const err = document.getElementById('err');
      err.style.display = 'none';
      if (pw.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.style.display = 'block'; return; }
      if (pw !== cpw) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
      try {
        const r = await fetch('/api/auth/reset-password/' + TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw })
        });
        const d = await r.json();
        if (d.success) {
          document.getElementById('form').style.display = 'none';
          document.getElementById('ok').style.display = 'block';
        } else {
          err.textContent = d.message || 'Reset failed. The link may have expired.';
          err.style.display = 'block';
        }
      } catch {
        err.textContent = 'Network error. Please try again.';
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`);
  }

  // Reset password
  async resetPassword(req, res, next) {
    try {
      const { token } = req.params;
      const { password } = req.body;

      const decoded = verifyToken(token);
      if (!decoded) {
        throw new AppError("Invalid or expired reset token", 400);
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: decoded.userId },
        data: { password: hashedPassword },
      });

      res.json({
        success: true,
        message: "Password reset successful",
      });
    } catch (error) {
      next(error);
    }
  }

  // Verify email
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;
      const decoded = verifyRefreshToken(token);

      if (!decoded) {
        throw new AppError("Invalid or expired verification token", 400);
      }

      await prisma.user.update({
        where: { id: decoded.userId },
        data: { emailVerified: true, status: "ACTIVE" },
      });

      res.json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // Logout
  async logout(req, res, next) {
    try {
      // In a real implementation, you might want to blacklist the token
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  }

  // Complete admin company profile (onboarding step for ADMIN / SUPER_ADMIN)
  async completeAdminProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        companyName,
        email,
        phoneNumber,
        country,
        city,
        region,
        address,
        landmark,
        lat,
        lng,
        employeeCount,
        registrationNumber,
        description,
        tags,
      } = req.body;

      if (!companyName) throw new AppError("Company name is required", 400);
      if (!email) throw new AppError("Company email is required", 400);
      if (!country || !city || !address)
        throw new AppError("Country, city and address are required", 400);

      const logoPath = req.file
        ? `/uploads/images/profiles/${req.file.filename}`
        : undefined;

      let parsedTags = [];
      if (tags) {
        try {
          parsedTags = JSON.parse(tags);
        } catch {
          parsedTags = [];
        }
      }

      // Generate a unique invite code for the company
      const crypto = require("crypto");
      const inviteCode = crypto.randomBytes(4).toString("hex").toUpperCase();

      // Upsert Admin record — if user already has a linked admin, update it; otherwise create
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { managedById: true },
      });

      let admin;
      if (currentUser?.managedById) {
        admin = await prisma.admin.update({
          where: { id: currentUser.managedById },
          data: {
            companyName: companyName.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber || null,
            country: country.trim(),
            city: city.trim(),
            region: region?.trim() || null,
            address: address.trim(),
            landmark: landmark?.trim() || null,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            employeeCount: employeeCount ? parseInt(employeeCount) : null,
            description: description?.trim() || null,
            tags: parsedTags,
            ...(logoPath && { companyLogo: logoPath }),
            profileCompleted: true,
          },
        });
      } else {
        admin = await prisma.admin.create({
          data: {
            companyName: companyName.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber || null,
            country: country.trim(),
            city: city.trim(),
            region: region?.trim() || null,
            address: address.trim(),
            landmark: landmark?.trim() || null,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            employeeCount: employeeCount ? parseInt(employeeCount) : null,
            description: description?.trim() || null,
            tags: parsedTags,
            companyLogo: logoPath || null,
            profileCompleted: true,
            inviteCode,
          },
        });
      }

      // Link user to admin company and mark onboarding complete
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { managedById: admin.id, onboardingStep: "COMPLETE" },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          status: true,
          onboardingStep: true,
          managedById: true,
        },
      });

      res.json({
        success: true,
        message: "Company profile completed successfully",
        data: { user: updatedUser, admin },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
