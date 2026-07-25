// Helper script to create the Cage table if it doesn't exist
// Run: node prisma/apply-cage-migration.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Creating Cage table if not exists...');
  
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Cage" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "cageId" TEXT NOT NULL,
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
  
  console.log('Cage table created successfully!');
  
  // Create unique index on cageId
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Cage_cageId_key" ON "Cage"("cageId");
  `);
  
  console.log('Unique index on cageId created!');
}

main()
  .catch(e => {
    console.error('Failed to create Cage table:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
