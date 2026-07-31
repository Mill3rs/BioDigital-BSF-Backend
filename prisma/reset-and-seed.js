#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

// Truncate order: children first, then parents (respects FK constraints)
async function truncateAll() {
  console.log('🗑️  Clearing all data...');

  // Delete in FK-safe order
  const deletions = [
    // Level 5 (most nested)
    'CartItem', 'OrderItem', 'QualityCheck',
    // Level 4
    'Shipment', 'Invoice', 'Cart', 'ProductReview', 'ProductVariant',
    // Level 3
    'Order', 'OfflineSync', 'Report', 'TeamAssignment',
    // Level 2
    'ProcessingBatch', 'WasteRecord', 'Vehicle', 'Cage', 'Product',
    'DriverProfile', 'BuyerProfile', 'SupplierProfile', 'Farm',
    'Notification', 'ActivityLog', 'SupportTicket', 'Integration',
    'PayoutRequest',
    // Level 1 (top-level reference tables)
    'Admin', 'SystemSetting',
    // Level 0 (root)
    'User',
  ];

  for (const model of deletions) {
    try {
      const result = await prisma[model].deleteMany();
      if (result.count > 0) {
        console.log(`  ✓ ${model}: ${result.count} rows deleted`);
      }
    } catch (err) {
      // Table might not exist or already empty — continue
    }
  }

  console.log('✅ All data cleared.\n');
}

const SUPER_ADMIN = {
  email: process.env.SUPER_ADMIN_EMAIL || 'biodigitaltech.ltduk@gmail.com',
  password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!',
  fullName: 'Super Admin',
  phoneNumber: '+233200000000',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
};

async function seed() {
  console.log('🌱 Seeding default data...');

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN.password, 12);

  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN.email },
    update: {},
    create: {
      email: SUPER_ADMIN.email,
      password: hashedPassword,
      fullName: SUPER_ADMIN.fullName,
      phoneNumber: SUPER_ADMIN.phoneNumber,
      role: SUPER_ADMIN.role,
      status: SUPER_ADMIN.status,
      emailVerified: true,
    },
  });

  console.log(`   Super Admin: ${admin.email} (${admin.id})`);

  // Seed default system settings
  const settings = [
    { key: 'phone_auth_enabled', value: 'true', description: 'Enable phone number authentication', category: 'auth', updatedBy: admin.id },
    { key: 'app_version', value: '1.0.0', description: 'Current app version', category: 'general', updatedBy: admin.id },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: s,
      create: s,
    });
    console.log(`   Setting: ${s.key} = ${s.value}`);
  }

  console.log('\n✅ Seed complete!');
}

async function main() {
  await truncateAll();
  await seed();
}

main()
  .catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
