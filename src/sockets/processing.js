const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { broadcastToFarm, sendToUser } = require('./helpers');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const userRole = socket.user.role;
  
  // Join batch room for real-time updates
  socket.on('batch:join', async (batchId) => {
    try {
      const batch = await prisma.processingBatch.findUnique({
        where: { id: batchId },
        select: { farmId: true, createdById: true }
      });
      
      if (!batch) {
        return socket.emit('error', { message: 'Batch not found' });
      }
      
      // Check if user is authorized
      const isAuthorized = 
        userId === batch.createdById ||
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && batch.farmId === socket.user.farmId);
      
      if (isAuthorized) {
        socket.join(`batch:${batchId}`);
        socket.emit('batch:joined', { batchId, success: true });
        logger.debug(`User ${userId} joined batch room: ${batchId}`);
      } else {
        socket.emit('error', { message: 'Not authorized to track this batch' });
      }
      
    } catch (error) {
      logger.error('Batch join error:', error);
      socket.emit('error', { message: 'Failed to join batch room' });
    }
  });
  
  // Leave batch room
  socket.on('batch:leave', (batchId) => {
    socket.leave(`batch:${batchId}`);
    logger.debug(`User ${userId} left batch room: ${batchId}`);
  });
  
  // Batch status update
  socket.on('batch:update-status', async (data) => {
    try {
      const { batchId, status, notes } = data;
      const validStatuses = ['PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'];
      
      if (!validStatuses.includes(status)) {
        return socket.emit('error', { message: 'Invalid batch status' });
      }
      
      // Check authorization
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to update batch status' });
      }
      
      const batch = await prisma.processingBatch.findUnique({
        where: { id: batchId },
        include: { farm: true }
      });
      
      if (!batch) {
        return socket.emit('error', { message: 'Batch not found' });
      }
      
      // Update batch
      await prisma.processingBatch.update({
        where: { id: batchId },
        data: { 
          status,
          ...(status === 'COMPLETED' && { completedAt: new Date(), endDate: new Date() }),
          ...(status === 'ACTIVE' && { startDate: new Date() })
        }
      });
      
      // Add activity log
      await prisma.activityLog.create({
        data: {
          batchId,
          action: `BATCH_${status}`,
          description: notes || `Batch status changed to ${status}`,
          performedById: userId
        }
      });
      
      // Broadcast status update
      const statusData = {
        batchId,
        batchNumber: batch.batchNumber,
        status,
        notes,
        updatedBy: socket.user.fullName,
        timestamp: new Date()
      };
      
      io.to(`batch:${batchId}`).emit('batch:status', statusData);
      
      // Notify farm
      if (batch.farmId) {
        broadcastToFarm(batch.farmId, 'batch:status', statusData);
      }
      
      logger.info(`Batch ${batchId} status updated to ${status} by ${userId}`);
      
    } catch (error) {
      logger.error('Batch status update error:', error);
      socket.emit('error', { message: 'Failed to update batch status' });
    }
  });
  
  // Update batch parameters (temperature, moisture, etc.)
  socket.on('batch:update-parameters', async (data) => {
    try {
      const { batchId, temperature, moistureContent, phLevel, materialLevel, co2Level } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to update batch parameters' });
      }
      
      const updateData = {};
      if (temperature !== undefined) updateData.temperature = temperature;
      if (moistureContent !== undefined) updateData.moistureContent = moistureContent;
      if (phLevel !== undefined) updateData.phLevel = phLevel;
      if (materialLevel !== undefined) updateData.materialLevel = materialLevel;
      if (co2Level !== undefined) updateData.co2Level = co2Level;
      
      await prisma.processingBatch.update({
        where: { id: batchId },
        data: updateData
      });
      
      // Add activity log for significant changes
      await prisma.activityLog.create({
        data: {
          batchId,
          action: 'PARAMETERS_UPDATED',
          description: `Parameters updated: ${JSON.stringify(updateData)}`,
          performedById: userId,
          metadata: updateData
        }
      });
      
      // Broadcast parameter update
      io.to(`batch:${batchId}`).emit('batch:parameters', {
        batchId,
        parameters: updateData,
        timestamp: new Date()
      });
      
      logger.debug(`Batch ${batchId} parameters updated by ${userId}`);
      
    } catch (error) {
      logger.error('Batch parameter update error:', error);
      socket.emit('error', { message: 'Failed to update batch parameters' });
    }
  });
  
  // Record batch output
  socket.on('batch:record-output', async (data) => {
    try {
      const { batchId, liquidOutput, fertilizerOutput, gasOutput, conversionRate, processingEfficiency } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to record batch output' });
      }
      
      const batch = await prisma.processingBatch.findUnique({
        where: { id: batchId },
        include: { wasteRecords: true }
      });
      
      if (!batch) {
        return socket.emit('error', { message: 'Batch not found' });
      }
      
      const updateData = {
        ...(liquidOutput !== undefined && { liquidOutput }),
        ...(fertilizerOutput !== undefined && { fertilizerOutput }),
        ...(gasOutput !== undefined && { gasOutput }),
        ...(conversionRate !== undefined && { conversionRate }),
        ...(processingEfficiency !== undefined && { processingEfficiency }),
        status: 'COMPLETED',
        completedAt: new Date(),
        endDate: new Date()
      };
      
      await prisma.processingBatch.update({
        where: { id: batchId },
        data: updateData
      });
      
      // Update associated waste records
      if (batch.wasteRecords.length > 0) {
        await prisma.wasteRecord.updateMany({
          where: { processingBatchId: batchId },
          data: {
            status: 'PROCESSED',
            processedQuantity: batch.quantity,
            processingDate: new Date()
          }
        });
      }
      
      // Add activity log
      await prisma.activityLog.create({
        data: {
          batchId,
          action: 'OUTPUT_RECORDED',
          description: `Output recorded: ${liquidOutput || 0}L liquid, ${fertilizerOutput || 0}kg fertilizer`,
          performedById: userId,
          metadata: { liquidOutput, fertilizerOutput, gasOutput, conversionRate }
        }
      });
      
      // Broadcast output recorded
      const outputData = {
        batchId,
        batchNumber: batch.batchNumber,
        output: { liquidOutput, fertilizerOutput, gasOutput, conversionRate },
        timestamp: new Date()
      };
      
      io.to(`batch:${batchId}`).emit('batch:output-recorded', outputData);
      
      // Notify farm
      if (batch.farmId) {
        broadcastToFarm(batch.farmId, 'batch:completed', outputData);
      }
      
      logger.info(`Batch ${batchId} output recorded by ${userId}`);
      
    } catch (error) {
      logger.error('Batch output recording error:', error);
      socket.emit('error', { message: 'Failed to record batch output' });
    }
  });
  
  // Add quality check result
  socket.on('batch:quality-check', async (data) => {
    try {
      const { batchId, checkType, parameter, value, passed, notes } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to add quality check' });
      }
      
      const qualityCheck = await prisma.qualityCheck.create({
        data: {
          batchId,
          checkType,
          parameter,
          value,
          unit: data.unit || '',
          passed,
          notes,
          checkedById: userId
        }
      });
      
      // Broadcast quality check result
      io.to(`batch:${batchId}`).emit('batch:quality-check', {
        batchId,
        qualityCheck,
        timestamp: new Date()
      });
      
      // Alert if quality check failed
      if (!passed) {
        io.to(`batch:${batchId}`).emit('batch:alert', {
          batchId,
          type: 'QUALITY_FAILED',
          message: `Quality check failed: ${parameter} = ${value}`,
          timestamp: new Date()
        });
        
        if (socket.user.farmId) {
          broadcastToFarm(socket.user.farmId, 'batch:alert', {
            batchId,
            type: 'QUALITY_FAILED',
            message: `Quality check failed for batch: ${parameter} = ${value}`,
            timestamp: new Date()
          });
        }
      }
      
      logger.info(`Quality check added for batch ${batchId} by ${userId}`);
      
      socket.emit('batch:quality-added', { qualityCheck, success: true });
      
    } catch (error) {
      logger.error('Quality check error:', error);
      socket.emit('error', { message: 'Failed to add quality check' });
    }
  });
  
  // Get real-time batch metrics
  socket.on('batch:metrics', async (batchId) => {
    try {
      const batch = await prisma.processingBatch.findUnique({
        where: { id: batchId },
        include: {
          wasteRecords: { take: 5, orderBy: { date: 'desc' } },
          qualityChecks: { take: 10, orderBy: { checkedAt: 'desc' } },
          activityLogs: { take: 10, orderBy: { timestamp: 'desc' } }
        }
      });
      
      if (!batch) {
        return socket.emit('error', { message: 'Batch not found' });
      }
      
      socket.emit('batch:metrics', {
        batchId,
        metrics: {
          temperature: batch.temperature,
          moistureContent: batch.moistureContent,
          phLevel: batch.phLevel,
          materialLevel: batch.materialLevel,
          co2Level: batch.co2Level,
          conversionRate: batch.conversionRate,
          processingEfficiency: batch.processingEfficiency
        },
        recentChecks: batch.qualityChecks,
        recentActivity: batch.activityLogs,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Get batch metrics error:', error);
      socket.emit('error', { message: 'Failed to get batch metrics' });
    }
  });
};