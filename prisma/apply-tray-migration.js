// Helper script to create the Tray table if it doesn't exist
// Run: node prisma/apply-tray-migration.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Creating Tray table if not exists...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Tray" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "trayId" TEXT NOT NULL,
      description TEXT,
      location TEXT,
      capacity DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      notes TEXT,
      "createdById" TEXT NOT NULL REFERENCES "Users"(id),
      "batchId" TEXT REFERENCES "ProcessingBatch"(id),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('Tray table created successfully!');

  // Create unique index on trayId
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Tray_trayId_key" ON "Tray"("trayId");
  `);

  console.log('Unique index on trayId created!');
}

main()
  .catch(e => {
    console.error('Failed to create Tray table:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
