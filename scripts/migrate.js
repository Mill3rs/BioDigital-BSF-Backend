#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config();

const execPromise = util.promisify(exec);
const prisma = new PrismaClient();

// Migration status tracking
const MIGRATION_STATUS_FILE = path.join(__dirname, '../.migration_status.json');

// Migration status
let migrationStatus = {
  lastRun: null,
  version: null,
  pending: [],
  completed: []
};

// Load migration status
function loadMigrationStatus() {
  if (fs.existsSync(MIGRATION_STATUS_FILE)) {
    const data = fs.readFileSync(MIGRATION_STATUS_FILE, 'utf8');
    migrationStatus = JSON.parse(data);
  }
}

// Save migration status
function saveMigrationStatus() {
  fs.writeFileSync(MIGRATION_STATUS_FILE, JSON.stringify(migrationStatus, null, 2));
}

// Run Prisma migrations
async function runPrismaMigrations() {
  console.log('🔄 Running Prisma migrations...');
  
  try {
    const { stdout, stderr } = await execPromise('npx prisma migrate deploy');
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log('✅ Prisma migrations completed');
    return { success: true };
  } catch (error) {
    console.error('❌ Prisma migrations failed:', error);
    return { success: false, error: error.message };
  }
}

// Generate Prisma client
async function generatePrismaClient() {
  console.log('🔄 Generating Prisma client...');
  
  try {
    await execPromise('npx prisma generate');
    console.log('✅ Prisma client generated');
    return { success: true };
  } catch (error) {
    console.error('❌ Prisma client generation failed:', error);
    return { success: false, error: error.message };
  }
}

// Run custom SQL migrations
async function runCustomMigrations() {
  const migrationsDir = path.join(__dirname, '../prisma/custom-migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('No custom migrations directory found');
    return { success: true };
  }
  
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  for (const file of migrationFiles) {
    if (migrationStatus.completed.includes(file)) {
      console.log(`⏭️ Skipping already applied migration: ${file}`);
      continue;
    }
    
    console.log(`🔄 Applying migration: ${file}`);
    
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await prisma.$executeRawUnsafe(sql);
      
      migrationStatus.completed.push(file);
      saveMigrationStatus();
      
      console.log(`✅ Applied migration: ${file}`);
    } catch (error) {
      console.error(`❌ Failed to apply migration ${file}:`, error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: true };
}

// Seed database with initial data
async function seedDatabase() {
  console.log('🌱 Seeding database...');
  
  try {
    // Check if seed already run
    const seedStatus = await prisma.systemSetting.findUnique({
      where: { key: 'db_seeded' }
    });
    
    if (seedStatus && seedStatus.value === 'true') {
      console.log('Database already seeded, skipping...');
      return { success: true };
    }
    
    // Run seed script
    await execPromise('npx prisma db seed');
    
    // Mark as seeded
    await prisma.systemSetting.upsert({
      where: { key: 'db_seeded' },
      update: { value: 'true' },
      create: {
        key: 'db_seeded',
        value: 'true',
        category: 'system',
        updatedBy: 'migration'
      }
    });
    
    console.log('✅ Database seeded successfully');
    return { success: true };
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    return { success: false, error: error.message };
  }
}

// Reset database (dangerous!)
async function resetDatabase() {
  console.log('⚠️  WARNING: This will delete all data in the database!');
  console.log('Type "CONFIRM" to proceed:');
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const answer = await new Promise((resolve) => {
    readline.question('> ', resolve);
  });
  
  readline.close();
  
  if (answer !== 'CONFIRM') {
    console.log('Reset cancelled');
    return { success: false, cancelled: true };
  }
  
  console.log('🔄 Resetting database...');
  
  try {
    await execPromise('npx prisma migrate reset --force');
    console.log('✅ Database reset completed');
    
    // Reset migration status
    migrationStatus = {
      lastRun: new Date().toISOString(),
      version: null,
      pending: [],
      completed: []
    };
    saveMigrationStatus();
    
    return { success: true };
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    return { success: false, error: error.message };
  }
}

// Create a new migration
async function createMigration(name) {
  if (!name) {
    console.error('Please provide a migration name');
    return { success: false };
  }
  
  console.log(`🔄 Creating migration: ${name}`);
  
  try {
    await execPromise(`npx prisma migrate dev --name ${name}`);
    console.log(`✅ Migration created: ${name}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Migration creation failed:', error);
    return { success: false, error: error.message };
  }
}

// Check migration status
async function checkMigrationStatus() {
  try {
    const { stdout } = await execPromise('npx prisma migrate status');
    console.log(stdout);
    
    // Get pending migrations
    const pendingMatch = stdout.match(/Pending migrations:\s*\n([\s\S]*?)(?=\n\n|$)/);
    if (pendingMatch) {
      const pending = pendingMatch[1].split('\n').filter(l => l.trim());
      migrationStatus.pending = pending;
    }
    
    migrationStatus.lastRun = new Date().toISOString();
    saveMigrationStatus();
    
    return { success: true, status: stdout };
  } catch (error) {
    console.error('Failed to check migration status:', error);
    return { success: false, error: error.message };
  }
}

// Run all migrations
async function runAllMigrations() {
  console.log('🚀 Starting migration process...');
  
  loadMigrationStatus();
  
  // Check migration status
  await checkMigrationStatus();
  
  // Run Prisma migrations
  const prismaResult = await runPrismaMigrations();
  if (!prismaResult.success) return prismaResult;
  
  // Generate Prisma client
  const generateResult = await generatePrismaClient();
  if (!generateResult.success) return generateResult;
  
  // Run custom migrations
  const customResult = await runCustomMigrations();
  if (!customResult.success) return customResult;
  
  // Seed database
  const seedResult = await seedDatabase();
  if (!seedResult.success) return seedResult;
  
  console.log('✅ All migrations completed successfully');
  return { success: true };
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'create':
      createMigration(args[1]).then(() => process.exit());
      break;
    case 'reset':
      resetDatabase().then(() => process.exit());
      break;
    case 'status':
      checkMigrationStatus().then(() => process.exit());
      break;
    case 'seed':
      seedDatabase().then(() => process.exit());
      break;
    case 'generate':
      generatePrismaClient().then(() => process.exit());
      break;
    case 'run':
    default:
      runAllMigrations().then(() => process.exit());
  }
}

module.exports = {
  runAllMigrations,
  createMigration,
  resetDatabase,
  checkMigrationStatus,
  seedDatabase,
  generatePrismaClient
};