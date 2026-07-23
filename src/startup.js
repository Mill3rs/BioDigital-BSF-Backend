// Run on startup to ensure required tables exist
const { prisma } = require('./config/database');
const logger = require('./utils/logger');

async function ensureCageTable() {
  try {
    // Check if Cage table exists by querying it
    await prisma.cage.findFirst();
    logger.info('Cage table already exists');
  } catch (err) {
    if (err.message && err.message.includes('does not exist')) {
      logger.info('Creating Cage table...');
      try {
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
          )
        `);
        await prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "Cage_cageId_key" ON "Cage"("cageId")
        `);
        logger.info('Cage table created successfully');
      } catch (createErr) {
        logger.error('Failed to create Cage table:', createErr.message);
      }
    } else {
      logger.error('Error checking Cage table:', err.message);
    }
  }
}

module.exports = { ensureCageTable };
