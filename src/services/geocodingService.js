const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

class GeocodingService {
  constructor() {
    this.apiKey = config.GOOGLE_MAPS_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';
  }

  async geocodeAddress(address) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          address: typeof address === 'string' ? address : this.formatAddress(address),
          key: this.apiKey
        }
      });
      
      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          components: result.address_components
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Geocoding error:', error);
      return null;
    }
  }

  async reverseGeocode(lat, lng) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          latlng: `${lat},${lng}`,
          key: this.apiKey
        }
      });
      
      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          components: result.address_components,
          plusCode: result.plus_code
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Reverse geocoding error:', error);
      return null;
    }
  }

  async calculateDistance(origin, destination) {
    try {
      const originCoords = typeof origin === 'string' 
        ? await this.geocodeAddress(origin)
        : origin;
      
      const destCoords = typeof destination === 'string'
        ? await this.geocodeAddress(destination)
        : destination;
      
      if (!originCoords || !destCoords) {
        return null;
      }
      
      const R = 6371; // Earth's radius in km
      const dLat = this.toRad(destCoords.lat - originCoords.lat);
      const dLon = this.toRad(destCoords.lng - originCoords.lng);
      
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.toRad(originCoords.lat)) * Math.cos(this.toRad(destCoords.lat)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      
      return {
        distanceKm: distance,
        distanceMiles: distance * 0.621371,
        durationHours: distance / 60 // Assuming 60 km/h average speed
      };
    } catch (error) {
      logger.error('Distance calculation error:', error);
      return null;
    }
  }

  async getNearbyLocations(lat, lng, radiusKm = 10, type = null) {
    try {
      // This is a mock implementation. In production, use Places API
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
        params: {
          location: `${lat},${lng}`,
          radius: radiusKm * 1000,
          type: type,
          key: this.apiKey
        }
      });
      
      if (response.data.status === 'OK') {
        return response.data.results.map(place => ({
          name: place.name,
          address: place.vicinity,
          location: {
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng
          },
          rating: place.rating,
          placeId: place.place_id
        }));
      }
      
      return [];
    } catch (error) {
      logger.error('Nearby locations error:', error);
      return [];
    }
  }

  async optimizeRoute(waypoints) {
    // Mock implementation for route optimization
    try {
      const distances = [];
      
      for (let i = 0; i < waypoints.length - 1; i++) {
        const distance = await this.calculateDistance(waypoints[i], waypoints[i + 1]);
        distances.push(distance?.distanceKm || 0);
      }
      
      const totalDistance = distances.reduce((sum, d) => sum + d, 0);
      const optimizedOrder = [...Array(waypoints.length).keys()];
      
      return {
        optimizedOrder,
        totalDistance,
        estimatedDuration: totalDistance / 60 // hours at 60 km/h
      };
    } catch (error) {
      logger.error('Route optimization error:', error);
      return null;
    }
  }

  formatAddress(address) {
    if (typeof address === 'object') {
      const parts = [];
      if (address.street) parts.push(address.street);
      if (address.city) parts.push(address.city);
      if (address.region) parts.push(address.region);
      if (address.country) parts.push(address.country);
      if (address.postalCode) parts.push(address.postalCode);
      return parts.join(', ');
    }
    return address;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  async validateAddress(address) {
    const result = await this.geocodeAddress(address);
    return !!result;
  }
}

module.exports = new GeocodingService();