const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class CSVService {
  constructor() {
    this.reportDir = path.join(config.UPLOAD_DIR, 'reports');
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async generateReportCSV(data, reportId) {
    try {
      const filename = `report-${reportId}-${Date.now()}.csv`;
      const filepath = path.join(this.reportDir, filename);
      
      let records = [];
      let headers = [];
      
      if (data.records && data.records.length > 0) {
        headers = [
          { id: 'date', title: 'Date' },
          { id: 'sourceName', title: 'Source Name' },
          { id: 'sourceType', title: 'Source Type' },
          { id: 'quantity', title: 'Quantity' },
          { id: 'unit', title: 'Unit' },
          { id: 'status', title: 'Status' },
          { id: 'carbonSaved', title: 'Carbon Saved (kg CO2e)' }
        ];
        
        records = data.records.map(record => ({
          date: new Date(record.date).toLocaleDateString(),
          sourceName: record.sourceName,
          sourceType: record.sourceType,
          quantity: record.quantity,
          unit: record.unit,
          status: record.status,
          carbonSaved: record.carbonSaved || 0
        }));
      } else if (data.summary) {
        headers = [
          { id: 'metric', title: 'Metric' },
          { id: 'value', title: 'Value' }
        ];
        
        records = [
          { metric: 'Total Waste', value: `${data.summary.totalWaste || 0} kg` },
          { metric: 'Total Carbon Saved', value: `${data.summary.totalCarbonSaved || 0} kg CO2e` },
          { metric: 'Total Records', value: data.summary.totalRecords || 0 }
        ];
        
        if (data.summary.bySourceType) {
          data.summary.bySourceType.forEach(item => {
            records.push({
              metric: `Waste - ${item.sourceType}`,
              value: `${item._sum.quantity || 0} kg`
            });
          });
        }
      }
      
      const csvWriter = createCsvWriter({
        path: filepath,
        header: headers
      });
      
      await csvWriter.writeRecords(records);
      
      const fileUrl = `/uploads/reports/${filename}`;
      return fileUrl;
    } catch (error) {
      logger.error('CSV generation error:', error);
      throw error;
    }
  }

  async exportWasteRecords(wasteRecords) {
    const filename = `waste-export-${Date.now()}.csv`;
    const filepath = path.join(this.reportDir, filename);
    
    const headers = [
      { id: 'id', title: 'ID' },
      { id: 'sourceName', title: 'Source Name' },
      { id: 'sourceType', title: 'Source Type' },
      { id: 'quantity', title: 'Quantity (kg)' },
      { id: 'date', title: 'Date' },
      { id: 'status', title: 'Status' },
      { id: 'carbonSaved', title: 'Carbon Saved (kg CO2e)' },
      { id: 'farmName', title: 'Farm Name' },
      { id: 'recordedBy', title: 'Recorded By' }
    ];
    
    const records = wasteRecords.map(record => ({
      id: record.id,
      sourceName: record.sourceName,
      sourceType: record.sourceType,
      quantity: record.quantity,
      date: new Date(record.date).toLocaleDateString(),
      status: record.status,
      carbonSaved: record.carbonSaved || 0,
      farmName: record.farm?.name || 'N/A',
      recordedBy: record.recordedBy?.fullName || 'N/A'
    }));
    
    const csvWriter = createCsvWriter({
      path: filepath,
      header: headers
    });
    
    await csvWriter.writeRecords(records);
    
    return `/uploads/reports/${filename}`;
  }

  async exportOrders(orders) {
    const filename = `orders-export-${Date.now()}.csv`;
    const filepath = path.join(this.reportDir, filename);
    
    const headers = [
      { id: 'orderNumber', title: 'Order Number' },
      { id: 'customer', title: 'Customer' },
      { id: 'total', title: 'Total ($)' },
      { id: 'status', title: 'Status' },
      { id: 'paymentMethod', title: 'Payment Method' },
      { id: 'createdAt', title: 'Created Date' },
      { id: 'itemsCount', title: 'Items Count' }
    ];
    
    const records = orders.map(order => ({
      orderNumber: order.orderNumber,
      customer: order.customer?.fullName || 'N/A',
      total: order.total,
      status: order.status,
      paymentMethod: order.paymentMethod,
      createdAt: new Date(order.createdAt).toLocaleDateString(),
      itemsCount: order.items?.length || 0
    }));
    
    const csvWriter = createCsvWriter({
      path: filepath,
      header: headers
    });
    
    await csvWriter.writeRecords(records);
    
    return `/uploads/reports/${filename}`;
  }
}

module.exports = new CSVService();