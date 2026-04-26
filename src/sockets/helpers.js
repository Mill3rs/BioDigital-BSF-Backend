/**
 * Socket.IO broadcast helpers.
 * Kept in a separate module to avoid circular dependencies between
 * sockets/index.js (which registers handlers) and the handler files
 * (drivers, orders, processing, notifications) that need these helpers.
 *
 * Call setIO(io) once after the Server instance is created.
 */

let io = null;

const setIO = (instance) => {
  io = instance;
};

const broadcastToFarm = (farmId, event, data) => {
  if (io) {
    io.to(`farm:${farmId}`).emit(event, data);
  }
};

const broadcastToRole = (role, event, data) => {
  if (io) {
    io.to(`role:${role}`).emit(event, data);
  }
};

const sendToUser = (userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

const broadcastToAll = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};

module.exports = { setIO, broadcastToFarm, broadcastToRole, sendToUser, broadcastToAll };
