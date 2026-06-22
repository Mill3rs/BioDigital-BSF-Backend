const express = require("express");
const { body } = require("express-validator");
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
const { uploadSingle } = require("../middleware/upload");
const notificationService = require("../services/notificationService");
const { prisma } = require("../config/database");

const router = express.Router();

// Public settings — no auth required (for clients to check feature flags)
router.get("/public-settings", async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "phone_auth_enabled" },
    });
    const phoneAuthEnabled = setting ? setting.value === "true" : false;
    res.json({ success: true, data: { phoneAuthEnabled } });
  } catch (error) {
    next(error);
  }
});

// Register
router.post(
  "/register",
  [
    body("email")
      .optional({ values: "falsy" })
      .isEmail()
      .withMessage("Valid email is required"),
    body("phoneNumber")
      .optional({ values: "falsy" })
      .notEmpty()
      .withMessage("Valid phone number is required"),
    body().custom((_, { req }) => {
      if (!req.body.email && !req.body.phoneNumber) {
        throw new Error("Email or phone number is required");
      }
      return true;
    }),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("fullName").notEmpty().withMessage("Full name is required"),
    body("role")
      .isIn(["FARMER", "DRIVER", "BUYER", "SUPPLIER", "ADMIN"])
      .withMessage("Valid role is required"),
  ],
  authController.register,
);

// Login
router.post(
  "/login",
  [
    body("identifier")
      .notEmpty()
      .withMessage("Email or phone number is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  authController.login,
);

// Refresh token
router.post(
  "/refresh-token",
  [body("refreshToken").notEmpty().withMessage("Refresh token is required")],
  authController.refreshToken,
);

// Forgot password
router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Valid email is required")],
  authController.forgotPassword,
);

// Reset password — GET shows the form, POST submits
router.get("/reset-password/:token", authController.resetPasswordForm);
router.post(
  "/reset-password/:token",
  [
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  authController.resetPassword,
);

// Verify email
router.get("/verify-email/:token", authController.verifyEmail);

// Logout
router.post("/logout", authenticate, authController.logout);

// Complete admin/super-admin company profile (onboarding)
router.post(
  "/complete-admin-profile",
  authenticate,
  uploadSingle("profile_image"),
  authController.completeAdminProfile,
);

// Complete location setup – final onboarding step
router.post(
  "/complete-location",
  authenticate,
  [
    body("country").notEmpty().withMessage("Country is required"),
    body("city").notEmpty().withMessage("City is required"),
    body("address").notEmpty().withMessage("Address is required"),
  ],
  async (req, res, next) => {
    const { prisma } = require("../config/database");
    const { AppError } = require("../middleware/errorHandler");
    try {
      const { country, city, address, landmark, lat, lng } = req.body;
      const userId = req.user.id;
      const role = req.user.role;

      const locationJson = {
        country,
        city,
        address,
        landmark: landmark || null,
        lat: lat || null,
        lng: lng || null,
      };

      // Persist location on the role-specific profile
      if (role === "SUPPLIER") {
        await prisma.supplierProfile.upsert({
          where: { userId },
          create: {
            userId,
            collectionAddress: locationJson,
            primaryProducts: [],
            wasteTypes: [],
          },
          update: { collectionAddress: locationJson },
        });
      } else if (role === "DRIVER") {
        await prisma.driverProfile.upsert({
          where: { userId },
          create: { userId, baseLocation: locationJson },
          update: { baseLocation: locationJson },
        });
      } else if (role === "BUYER") {
        await prisma.buyerProfile.upsert({
          where: { userId },
          create: { userId, deliveryAddress: locationJson },
          update: { deliveryAddress: locationJson },
        });
      }

      // Advance onboarding to COMPLETE
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { onboardingStep: "COMPLETE" },
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
        message: "Location saved successfully",
        data: { user: updatedUser },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Verify company invite code – links the authenticated user to a company
router.post(
  "/verify-company-code",
  authenticate,
  [body("code").notEmpty().withMessage("Company code is required")],
  async (req, res, next) => {
    const { prisma } = require("../config/database");
    const { AppError } = require("../middleware/errorHandler");
    try {
      const { code } = req.body;
      const userId = req.user.id;
      const role = req.user.role;

      const admin = await prisma.admin.findFirst({
        where: { inviteCode: code.trim().toUpperCase() },
        select: { id: true, companyName: true },
      });
      if (!admin) {
        throw new AppError("Invalid company code", 404);
      }

      // Link user to admin company and advance onboarding
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          managedById: admin.id,
          onboardingStep: "PENDING_LOCATION",
        },
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

      // Also set adminId on the role-specific profile
      if (role === "SUPPLIER") {
        await prisma.supplierProfile.upsert({
          where: { userId },
          create: {
            userId,
            adminId: admin.id,
            primaryProducts: [],
            wasteTypes: [],
          },
          update: { adminId: admin.id },
        });
      } else if (role === "DRIVER") {
        await prisma.driverProfile.upsert({
          where: { userId },
          create: { userId, adminId: admin.id },
          update: { adminId: admin.id },
        });
      }

      res.json({
        success: true,
        message: "Company linked successfully",
        data: { user: updatedUser, companyName: admin.companyName },
      });

      // Non-blocking: notify admins/managers that a new user has joined their company
      let roleLabel;
      if (role === "SUPPLIER") {
        roleLabel = "Supplier";
      } else if (role === "DRIVER") {
        roleLabel = "Driver";
      } else {
        roleLabel = role;
      }
      const emoji = role === "SUPPLIER" ? "🧑‍🌾" : "🚚";
      notificationService
        .notifyAdminsAndManagers(
          null,
          `${roleLabel} Joined Company ${emoji}`,
          `${updatedUser.fullName} has linked to ${admin.companyName} as a ${roleLabel} and is ready for approval.`,
          "SYSTEM",
          {
            userId: updatedUser.id,
            userRole: role,
            companyName: admin.companyName,
          },
          "user:registered",
          {
            userId: updatedUser.id,
            fullName: updatedUser.fullName,
            role,
            companyName: admin.companyName,
          },
        )
        .catch(() => {});
    } catch (error) {
      next(error);
    }
  },
);

// Google Sign-In / Register
router.post(
  "/google",
  [
    body("idToken").notEmpty().withMessage("Google ID token is required"),
    body("role")
      .optional()
      .isIn(["BUYER", "SUPPLIER", "DRIVER"])
      .withMessage("Invalid role"),
  ],
  authController.googleSignIn.bind(authController),
);

// Apple Sign-In / Register
router.post(
  "/apple",
  [
    body("identityToken")
      .notEmpty()
      .withMessage("Apple identity token is required"),
    body("role")
      .optional()
      .isIn(["BUYER", "SUPPLIER", "DRIVER"])
      .withMessage("Invalid role"),
  ],
  authController.appleSignIn.bind(authController),
);

module.exports = router;
