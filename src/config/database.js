const { PrismaClient } = require('@prisma/client');
const config = require('./index');
const logger = require('../utils/logger');

// Database configuration
const dbConfig = {
  url: config.DATABASE_URL,
  connectionLimit: config.DATABASE_MAX_CONNECTIONS,
  idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT,
  connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT
};

// Prisma client configuration
const prismaClientOptions = {
  log: config.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
  errorFormat: 'pretty',
  datasources: {
    db: {
      url: dbConfig.url
    }
  }
};

// Create Prisma client instance
const prisma = new PrismaClient(prismaClientOptions);

// Database connection management
let isConnected = false;

const connectDatabase = async () => {
  try {
    if (!isConnected) {
      await prisma.$connect();
      isConnected = true;
      logger.info('✅ Database connected successfully');
      
      // Test connection
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database connection verified');
    }
    return true;
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    isConnected = false;
    throw error;
  }
};

const disconnectDatabase = async () => {
  try {
    if (isConnected) {
      await prisma.$disconnect();
      isConnected = false;
      logger.info('Database disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting database:', error);
    throw error;
  }
};

// Health check function
const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', latency: null };
  } catch (error) {
    logger.error('Database health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

// Get database stats
const getDatabaseStats = async () => {
  try {
    const stats = await prisma.$queryRaw`
      SELECT 
        pg_database_size(current_database()) as size,
        (SELECT count(*) FROM pg_stat_activity) as connections
    `;
    return stats[0];
  } catch (error) {
    logger.error('Error getting database stats:', error);
    return null;
  }
};

// Transaction helper
const transaction = async (callback) => {
  try {
    return await prisma.$transaction(async (tx) => {
      return await callback(tx);
    });
  } catch (error) {
    logger.error('Transaction failed:', error);
    throw error;
  }
};

// Batch operation helper
const batchOperation = async (items, operation, batchSize = 100) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const result = await operation(batch);
    results.push(result);
  }
  return results;
};

module.exports = {
  prisma,
  dbConfig,
  connectDatabase,
  disconnectDatabase,
  checkDatabaseHealth,
  getDatabaseStats,
  transaction,
  batchOperation
};