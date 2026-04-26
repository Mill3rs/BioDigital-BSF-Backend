const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const config = require('../config');
const helpers = require('./helpers');

// Socket.IO event handlers
const driverHandlers = require('./drivers');
const orderHandlers = require('./orders');
const processingHandlers = require('./processing');
const notificationHandlers = require('./notifications');

let io = null;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: config.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST']
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          farm: true,
          driverProfile: true
        }
      });
      
      if (!user) {
        return next(new Error('User not found'));
      }
      
      socket.user = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        farmId: user.farm?.id,
        driverId: user.driverProfile?.id
      };
      
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} - User: ${socket.user?.id} (${socket.user?.role})`);
    
    // Join user-specific room
    socket.join(`user:${socket.user.id}`);
    
    // Join role-specific room
    socket.join(`role:${socket.user.role}`);
    
    // Join farm room if applicable
    if (socket.user.farmId) {
      socket.join(`farm:${socket.user.farmId}`);
    }
    
    // Join driver room if applicable
    if (socket.user.role === 'DRIVER') {
      socket.join('drivers:online');
    }
    
    // Send connection confirmation
    socket.emit('connected', {
      socketId: socket.id,
      userId: socket.user.id,
      role: socket.user.role,
      timestamp: new Date()
    });
    
    // Broadcast user online status
    io.emit('user:online', {
      userId: socket.user.id,
      role: socket.user.role,
      timestamp: new Date()
    });
    
    // Initialize feature-specific handlers
    driverHandlers(io, socket);
    orderHandlers(io, socket);
    processingHandlers(io, socket);
    notificationHandlers(io, socket);
    
    // Disconnect handler
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id} - User: ${socket.user?.id}`);
      
      // Broadcast user offline status
      if (socket.user) {
        io.emit('user:offline', {
          userId: socket.user.id,
          role: socket.user.role,
          timestamp: new Date()
        });
        
        if (socket.user.role === 'DRIVER') {
          io.to('drivers:online').emit('driver:offline', {
            driverId: socket.user.id,
            timestamp: new Date()
          });
        }
      }
    });
    
    // Error handler
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
      socket.emit('error', { message: 'Internal socket error' });
    });
    
    // Ping/Pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });
  
// Initialise helpers so handler files can use broadcastToFarm etc.
  helpers.setIO(io);

  // Store io instance globally for access from other modules
  global.io = io;
  
  logger.info('Socket.IO server initialized');
  
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

const { broadcastToFarm, broadcastToRole, sendToUser, broadcastToAll } = helpers;

module.exports = {
  initializeSocket,
  getIO,
  broadcastToFarm,
  broadcastToRole,
  sendToUser,
  broadcastToAll
};