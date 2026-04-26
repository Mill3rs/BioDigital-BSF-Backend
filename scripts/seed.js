#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

// Seed data
const seedData = {
  // System settings
  settings: [
    { key: 'app_name', value: 'BioDigital BSF', category: 'general', description: 'Application name' },
    { key: 'app_version', value: '1.0.0', category: 'general', description: 'Application version' },
    { key: 'maintenance_mode', value: 'false', category: 'system', description: 'Maintenance mode status' },
    { key: 'default_language', value: 'en', category: 'localization', description: 'Default language' },
    { key: 'timezone', value: 'Africa/Accra', category: 'localization', description: 'Default timezone' },
    { key: 'currency', value: 'GHS', category: 'commerce', description: 'Default currency' },
    { key: 'tax_rate', value: '15', category: 'commerce', description: 'Default tax rate percentage' },
    { key: 'max_upload_size', value: '5242880', category: 'system', description: 'Maximum file upload size in bytes' },
    { key: 'allowed_file_types', value: 'image/jpeg,image/png,image/jpg,application/pdf', category: 'system', description: 'Allowed file types' }
  ],
  
  // Super Admin user
  superAdmin: {
    email: 'superadmin@biodigital.com',
    password: 'Admin123@',
    fullName: 'Super Admin',
    phoneNumber: '+233200000000',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE'
  },
  
  // Sample farm types
  farmTypes: [
    { type: 'FAMILY_FARM', description: 'Small family-owned farm' },
    { type: 'PROFESSIONAL_FARM', description: 'Commercial professional farm' },
    { type: 'CORPORATE_FARM', description: 'Large corporate agricultural operation' },
    { type: 'COOPERATIVE_FARM', description: 'Farmer cooperative' },
    { type: 'PERSONAL_FARM', description: 'Personal/hobby farm' },
    { type: 'COMMUNITY_FARM', description: 'Community-based farm' }
  ],
  
  // Sample waste source types
  wasteSourceTypes: [
    { type: 'AGRICULTURAL', description: 'Agricultural waste' },
    { type: 'FOOD_WASTE', description: 'Food processing waste' },
    { type: 'MARKET_WASTE', description: 'Market waste' },
    { type: 'HOUSEHOLD', description: 'Household organic waste' },
    { type: 'INDUSTRIAL', description: 'Industrial organic waste' },
    { type: 'MUNICIPAL', description: 'Municipal waste' },
    { type: 'COMMERCIAL', description: 'Commercial establishment waste' }
  ],
  
  // Sample process types
  processTypes: [
    { type: 'COMPOSTING', description: 'Traditional composting' },
    { type: 'ANAEROBIC_DIGESTION', description: 'Anaerobic digestion' },
    { type: 'VERMICOMPOSTING', description: 'Worm composting' },
    { type: 'BSF_LARVAE_PROCESSING', description: 'Black Soldier Fly larvae processing' },
    { type: 'FERMENTATION', description: 'Fermentation process' },
    { type: 'DRYING', description: 'Thermal drying' },
    { type: 'PELLETIZING', description: 'Pellet production' }
  ],
  
  // Product categories
  productCategories: [
    { category: 'ORGANIC_FERTILIZER', name: 'Organic Fertilizer', icon: '🌱' },
    { category: 'PROTEIN_FEED', name: 'Protein Feed', icon: '🐓' },
    { category: 'INSECT_OIL', name: 'Insect Oil', icon: '🪲' },
    { category: 'SOIL_CONDITIONER', name: 'Soil Conditioner', icon: '🌍' },
    { category: 'DRIED_LARVAE', name: 'Dried Larvae', icon: '🐛' },
    { category: 'COMPOST', name: 'Compost', icon: '🗑️' },
    { category: 'LIQUID_FERTILIZER', name: 'Liquid Fertilizer', icon: '💧' },
    { category: 'BIOCHAR', name: 'Biochar', icon: '🔥' }
  ],
  
  // Notification templates
  notificationTemplates: [
    { type: 'WELCOME', title: 'Welcome to BioDigital BSF', template: 'welcome' },
    { type: 'ORDER_CONFIRMATION', title: 'Order Confirmation', template: 'orderConfirmation' },
    { type: 'ORDER_SHIPPED', title: 'Order Shipped', template: 'orderShipped' },
    { type: 'ORDER_DELIVERED', title: 'Order Delivered', template: 'orderDelivered' },
    { type: 'WASTE_COLLECTION', title: 'Waste Collection Scheduled', template: 'wasteCollection' },
    { type: 'BATCH_COMPLETE', title: 'Batch Processing Complete', template: 'batchComplete' },
    { type: 'PASSWORD_RESET', title: 'Password Reset Request', template: 'passwordReset' }
  ]
};

// Hash password
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

// Seed system settings
async function seedSettings() {
  console.log('🌱 Seeding system settings...');
  
  for (const setting of seedData.settings) {
    const record = { ...setting, updatedBy: 'seed' };
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: record,
      create: record
    });
  }
  
  console.log(`✅ Seeded ${seedData.settings.length} system settings`);
}

// Seed super admin
async function seedSuperAdmin() {
  console.log('🌱 Seeding super admin...');
  
  const hashedPassword = await hashPassword(seedData.superAdmin.password);
  
  const adminUser = await prisma.user.upsert({
    where: { email: seedData.superAdmin.email },
    update: {},
    create: {
      email: seedData.superAdmin.email,
      password: hashedPassword,
      fullName: seedData.superAdmin.fullName,
      phoneNumber: seedData.superAdmin.phoneNumber,
      role: seedData.superAdmin.role,
      status: seedData.superAdmin.status,
      emailVerified: true
    }
  });

  // Ensure a corresponding Admin record exists
  const existingAdmin = await prisma.admin.findFirst({
    where: { users: { some: { id: adminUser.id } } }
  });

  if (!existingAdmin) {
    await prisma.admin.create({
      data: {
        companyName: 'BioDigital BSF',
        country: 'Ghana',
        phoneNumber: seedData.superAdmin.phoneNumber,
        subscription: 'ACTIVE',
        users: { connect: { id: adminUser.id } }
      }
    });
  }

  console.log(`✅ Seeded super admin: ${adminUser.email}`);
  return adminUser;
}

// Seed farm types (stored as system settings)
async function seedFarmTypes() {
  console.log('🌱 Seeding farm types...');
  
  await prisma.systemSetting.upsert({
    where: { key: 'farm_types' },
    update: { value: JSON.stringify(seedData.farmTypes) },
    create: {
      key: 'farm_types',
      value: JSON.stringify(seedData.farmTypes),
      category: 'enums',
      description: 'Available farm types',
      updatedBy: 'seed'
    }
  });
  
  console.log(`✅ Seeded ${seedData.farmTypes.length} farm types`);
}

// Seed waste source types
async function seedWasteSourceTypes() {
  console.log('🌱 Seeding waste source types...');
  
  await prisma.systemSetting.upsert({
    where: { key: 'waste_source_types' },
    update: { value: JSON.stringify(seedData.wasteSourceTypes) },
    create: {
      key: 'waste_source_types',
      value: JSON.stringify(seedData.wasteSourceTypes),
      category: 'enums',
      description: 'Available waste source types',
      updatedBy: 'seed'
    }
  });
  
  console.log(`✅ Seeded ${seedData.wasteSourceTypes.length} waste source types`);
}

// Seed process types
async function seedProcessTypes() {
  console.log('🌱 Seeding process types...');
  
  await prisma.systemSetting.upsert({
    where: { key: 'process_types' },
    update: { value: JSON.stringify(seedData.processTypes) },
    create: {
      key: 'process_types',
      value: JSON.stringify(seedData.processTypes),
      category: 'enums',
      description: 'Available process types',
      updatedBy: 'seed'
    }
  });
  
  console.log(`✅ Seeded ${seedData.processTypes.length} process types`);
}

// Seed product categories
async function seedProductCategories() {
  console.log('🌱 Seeding product categories...');
  
  await prisma.systemSetting.upsert({
    where: { key: 'product_categories' },
    update: { value: JSON.stringify(seedData.productCategories) },
    create: {
      key: 'product_categories',
      value: JSON.stringify(seedData.productCategories),
      category: 'enums',
      description: 'Available product categories',
      updatedBy: 'seed'
    }
  });
  
  console.log(`✅ Seeded ${seedData.productCategories.length} product categories`);
}

// Seed notification templates
async function seedNotificationTemplates() {
  console.log('🌱 Seeding notification templates...');
  
  await prisma.systemSetting.upsert({
    where: { key: 'notification_templates' },
    update: { value: JSON.stringify(seedData.notificationTemplates) },
    create: {
      key: 'notification_templates',
      value: JSON.stringify(seedData.notificationTemplates),
      category: 'notifications',
      description: 'Notification templates',
      updatedBy: 'seed'
    }
  });
  
  console.log(`✅ Seeded ${seedData.notificationTemplates.length} notification templates`);
}

// Seed sample farm (optional)
async function seedSampleFarm() {
  console.log('🌱 Creating sample farm...');
  
  // Check if sample farm already exists
  const existingFarm = await prisma.farm.findFirst({
    where: { name: 'BioDigital Sample Farm' }
  });
  
  if (existingFarm) {
    console.log('Sample farm already exists, skipping...');
    return;
  }
  
  // Get super admin user
  const superAdmin = await prisma.user.findUnique({
    where: { email: seedData.superAdmin.email }
  });

  if (!superAdmin) {
    console.log('Super admin not found, skipping sample farm...');
    return;
  }

  // Get the Admin record linked to the super admin user
  const adminRecord = await prisma.admin.findFirst({
    where: { users: { some: { id: superAdmin.id } } }
  });

  if (!adminRecord) {
    console.log('Admin record not found, skipping sample farm...');
    return;
  }

  // Create sample farm
  const farm = await prisma.farm.create({
    data: {
      name: 'BioDigital Sample Farm',
      type: 'FAMILY_FARM',
      description: 'Sample farm for demonstration purposes',
      area: 50,
      areaUnit: 'hectares',
      country: 'Ghana',
      region: 'Greater Accra',
      city: 'Accra',
      status: 'ACTIVE',
      adminId: adminRecord.id
    }
  });
  
  console.log(`✅ Created sample farm: ${farm.name}`);
  
  // Create sample waste record
  const wasteRecord = await prisma.wasteRecord.create({
    data: {
      sourceName: 'Sample Market Waste',
      sourceType: 'MARKET_WASTE',
      quantity: 500,
      unit: 'kg',
      date: new Date(),
      status: 'PENDING',
      description: 'Sample waste record for demonstration',
      farmId: farm.id,
      recordedById: superAdmin.id
    }
  });
  
  console.log(`✅ Created sample waste record: ${wasteRecord.id}`);
}

// Main seed function
async function main() {
  console.log('🚀 Starting database seeding...\n');
  
  try {
    // Seed all data
    await seedSettings();
    await seedFarmTypes();
    await seedWasteSourceTypes();
    await seedProcessTypes();
    await seedProductCategories();
    await seedNotificationTemplates();
    await seedSuperAdmin();
    await seedSampleFarm();
    
    // Mark database as seeded
    await prisma.systemSetting.upsert({
      where: { key: 'db_seeded' },
      update: { value: 'true' },
      create: {
        key: 'db_seeded',
        value: 'true',
        category: 'system',
        description: 'Database seeding status',
        updatedBy: 'seed'
      }
    });
    
    console.log('\n✅ Database seeding completed successfully!');
  } catch (error) {
    console.error('\n❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run seed if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  seedSettings,
  seedSuperAdmin,
  seedFarmTypes,
  seedWasteSourceTypes,
  seedProcessTypes,
  seedProductCategories,
  seedNotificationTemplates,
  seedSampleFarm,
  main
};