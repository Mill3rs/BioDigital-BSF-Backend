const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

// Redis configuration
const redisConfig = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  db: config.REDIS_DB,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
  keepAlive: 30000,
  family: 4
};

// Create Redis client instance
let redisClient = null;
let isConnected = false;

const createRedisClient = () => {
  if (!redisClient) {
    redisClient = new Redis(redisConfig);
    
    // Event handlers
    redisClient.on('connect', () => {
      logger.info('Redis connecting...');
    });
    
    redisClient.on('ready', () => {
      isConnected = true;
      logger.info('✅ Redis connected successfully');
    });
    
    redisClient.on('error', (error) => {
      logger.error('Redis connection error:', error);
      isConnected = false;
    });
    
    redisClient.on('close', () => {
      logger.warn('Redis connection closed');
      isConnected = false;
    });
    
    redisClient.on('reconnecting', () => {
      logger.info('Redis reconnecting...');
    });
  }
  return redisClient;
};

const connectRedis = async () => {
  try {
    const client = createRedisClient();
    await client.connect();
    return client;
  } catch (error) {
    logger.error('Failed to connect to Redis:', error);
    throw error;
  }
};

const disconnectRedis = async () => {
  try {
    if (redisClient && isConnected) {
      await redisClient.quit();
      isConnected = false;
      logger.info('Redis disconnected');
    }
  } catch (error) {
    logger.error('Error disconnecting Redis:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
};

// Cache helper functions
const cacheGet = async (key) => {
  try {
    const client = getRedisClient();
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error(`Redis cache get error for key ${key}:`, error);
    return null;
  }
};

const cacheSet = async (key, value, ttl = config.CACHE_TTL) => {
  try {
    const client = getRedisClient();
    const serialized = JSON.stringify(value);
    if (ttl) {
      await client.setex(key, ttl, serialized);
    } else {
      await client.set(key, serialized);
    }
    return true;
  } catch (error) {
    logger.error(`Redis cache set error for key ${key}:`, error);
    return false;
  }
};

const cacheDel = async (key) => {
  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (error) {
    logger.error(`Redis cache delete error for key ${key}:`, error);
    return false;
  }
};

const cacheDelPattern = async (pattern) => {
  try {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
    return keys.length;
  } catch (error) {
    logger.error(`Redis cache delete pattern error for ${pattern}:`, error);
    return 0;
  }
};

const cacheExists = async (key) => {
  try {
    const client = getRedisClient();
    return await client.exists(key);
  } catch (error) {
    logger.error(`Redis cache exists error for key ${key}:`, error);
    return false;
  }
};

const cacheIncrement = async (key, increment = 1) => {
  try {
    const client = getRedisClient();
    return await client.incrby(key, increment);
  } catch (error) {
    logger.error(`Redis cache increment error for key ${key}:`, error);
    return null;
  }
};

// Health check
const checkRedisHealth = async () => {
  try {
    const client = getRedisClient();
    const pong = await client.ping();
    return { status: pong === 'PONG' ? 'healthy' : 'unhealthy' };
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

// Pub/Sub helpers
const publish = async (channel, message) => {
  try {
    const client = getRedisClient();
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);
    await client.publish(channel, serialized);
    return true;
  } catch (error) {
    logger.error(`Redis publish error for channel ${channel}:`, error);
    return false;
  }
};

const subscribe = async (channel, callback) => {
  try {
    const client = getRedisClient();
    await client.subscribe(channel);
    client.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch {
          callback(message);
        }
      }
    });
    return true;
  } catch (error) {
    logger.error(`Redis subscribe error for channel ${channel}:`, error);
    return false;
  }
};

module.exports = {
  redisConfig,
  createRedisClient,
  connectRedis,
  disconnectRedis,
  getRedisClient,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  cacheExists,
  cacheIncrement,
  checkRedisHealth,
  publish,
  subscribe
};