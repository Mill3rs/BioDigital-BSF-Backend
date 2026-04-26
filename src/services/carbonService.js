const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class CarbonService {
  constructor() {
    this.apiKey = config.CARBON_API_KEY;
    this.apiUrl = config.CARBON_API_URL;
  }

  // Calculate carbon savings based on waste type and quantity
  async calculateCarbonSavings(quantity, wasteType, unit = 'kg') {
    try {
      // Convert to kg if needed
      let kgQuantity = quantity;
      if (unit === 'tons') {
        kgQuantity = quantity * 1000;
      } else if (unit === 'g') {
        kgQuantity = quantity / 1000;
      }
      
      // Carbon emission factors (kg CO2e per kg of waste)
      const emissionFactors = {
        'AGRICULTURAL': 0.5,
        'FOOD_WASTE': 0.8,
        'MARKET_WASTE': 0.6,
        'HOUSEHOLD': 0.4,
        'INDUSTRIAL': 1.2,
        'MUNICIPAL': 0.7,
        'COMMERCIAL': 0.5,
        'OTHER': 0.6
      };
      
      const factor = emissionFactors[wasteType] || 0.6;
      const carbonSaved = kgQuantity * factor;
      
      // If external API is configured, use it for more accurate calculation
      if (this.apiKey && this.apiUrl) {
        try {
          const externalResult = await this.getExternalCarbonData(kgQuantity, wasteType);
          if (externalResult) {
            return externalResult;
          }
        } catch (error) {
          logger.warn('External carbon API failed, using local calculation:', error.message);
        }
      }
      
      return carbonSaved;
    } catch (error) {
      logger.error('Carbon calculation error:', error);
      return quantity * 0.6; // Default fallback
    }
  }

  async getExternalCarbonData(quantity, wasteType) {
    try {
      const response = await axios.post(`${this.apiUrl}/estimates`, {
        type: 'waste',
        waste_type: wasteType.toLowerCase(),
        waste_amount: quantity,
        waste_amount_unit: 'kg'
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.data.data.attributes.carbon_kg;
    } catch (error) {
      logger.error('External carbon API error:', error.response?.data || error.message);
      return null;
    }
  }

  // Calculate carbon savings from processing
  calculateProcessingSavings(inputQuantity, outputQuantity, processType) {
    const savingsFactors = {
      'COMPOSTING': 0.7,
      'ANAEROBIC_DIGESTION': 0.9,
      'VERMICOMPOSTING': 0.65,
      'BSF_LARVAE_PROCESSING': 0.85,
      'OTHER': 0.5
    };
    
    const factor = savingsFactors[processType] || 0.6;
    const processed = inputQuantity * factor;
    const avoided = inputQuantity - outputQuantity;
    
    return {
      totalSavings: processed + avoided,
      processingSavings: processed,
      landfillAvoidance: avoided
    };
  }

  // Get carbon footprint report
  async getCarbonReport(farmId, startDate, endDate) {
    try {
      const wasteRecords = await prisma.wasteRecord.findMany({
        where: {
          farmId,
          date: {
            gte: startDate,
            lte: endDate
          },
          carbonSaved: { not: null }
        }
      });
      
      const processingBatches = await prisma.processingBatch.findMany({
        where: {
          farmId,
          endDate: {
            gte: startDate,
            lte: endDate
          },
          status: 'COMPLETED'
        }
      });
      
      const totalWasteCarbon = wasteRecords.reduce((sum, w) => sum + (w.carbonSaved || 0), 0);
      
      const processingSavings = processingBatches.reduce((sum, b) => {
        const savings = this.calculateProcessingSavings(b.quantity, b.fertilizerOutput || 0, b.processType);
        return sum + savings.totalSavings;
      }, 0);
      
      const totalSavings = totalWasteCarbon + processingSavings;
      
      // Equivalent trees planted (1 tree absorbs ~22kg CO2 per year)
      const treesEquivalent = Math.floor(totalSavings / 22);
      
      // Equivalent car miles (1 mile ~ 0.4kg CO2)
      const carMilesEquivalent = Math.floor(totalSavings / 0.4);
      
      return {
        period: { startDate, endDate },
        wasteCarbonSavings: totalWasteCarbon,
        processingCarbonSavings: processingSavings,
        totalCarbonSavings: totalSavings,
        equivalents: {
          treesPlanted: treesEquivalent,
          carMilesDriven: carMilesEquivalent,
          gallonsOfGasoline: Math.floor(totalSavings / 8.89),
          kWhOfElectricity: Math.floor(totalSavings / 0.45)
        },
        wasteRecordsCount: wasteRecords.length,
        processingBatchesCount: processingBatches.length
      };
    } catch (error) {
      logger.error('Carbon report error:', error);
      return null;
    }
  }
}

module.exports = new CarbonService();