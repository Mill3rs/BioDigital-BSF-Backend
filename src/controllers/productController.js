const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');

class ProductController {
  // Get all products
  async getAllProducts(req, res, next) {
    try {
      const {
        category,
        status,
        farmId,
        minPrice,
        maxPrice,
        search,
        page = 1,
        limit = 20
      } = req.query;
      
      const where = {};
      if (category) where.category = category;
      if (status) where.status = status;
      if (farmId) where.farmId = farmId;
      
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags: { has: search } }
        ];
      }
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
            farm: { select: { id: true, name: true } },
            _count: { select: { reviews: true } }
          },
          skip,
          take: pagination.limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.product.count({ where })
      ]);
      
      let filteredProducts = products;
      if (minPrice || maxPrice) {
        filteredProducts = products.filter(product => {
          const minVariantPrice = Math.min(...product.variants.map(v => v.price));
          if (minPrice && minVariantPrice < parseFloat(minPrice)) return false;
          if (maxPrice && minVariantPrice > parseFloat(maxPrice)) return false;
          return true;
        });
      }
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: filteredProducts, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Create product
  async createProduct(req, res, next) {
    try {
      const {
        name,
        description,
        shortDescription,
        category,
        images,
        tags,
        farmId,
        variants
      } = req.body;
      
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      const product = await prisma.product.create({
        data: {
          name,
          description,
          shortDescription,
          category,
          images: images || [],
          tags: tags || [],
          slug,
          farmId: farmId || req.user.farmId,
          status: 'ACTIVE',
          variants: {
            create: variants.map(variant => ({
              name: variant.name,
              sku: variant.sku || `${slug}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              quantity: parseInt(variant.quantity),
              price: parseFloat(variant.price),
              comparePrice: variant.comparePrice ? parseFloat(variant.comparePrice) : null,
              cost: variant.cost ? parseFloat(variant.cost) : null,
              unitType: variant.unitType,
              unitValue: variant.unitValue ? parseFloat(variant.unitValue) : null,
              minOrderQuantity: variant.minOrderQuantity || 1,
              maxOrderQuantity: variant.maxOrderQuantity || null,
              weight: variant.weight ? parseFloat(variant.weight) : null,
              dimensions: variant.dimensions || null,
              images: variant.images || []
            }))
          }
        },
        include: { variants: true }
      });
      
      res.status(201).json({ success: true, data: product });
    } catch (error) {
      next(error);
    }
  }

  // Get product by ID
  async getProductById(req, res, next) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: req.params.id },
        include: {
          variants: { where: { isActive: true } },
          farm: { select: { id: true, name: true, region: true, rating: true } },
          reviews: {
            include: { user: { select: { id: true, fullName: true, profileImage: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          _count: { select: { reviews: true } }
        }
      });
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }
      
      const avgRating = product.reviews.length > 0
        ? product.reviews.reduce((sum, r) => sum + r.rating, 0) / product.reviews.length
        : 0;
      
      res.json({ success: true, data: { ...product, averageRating: avgRating } });
    } catch (error) {
      next(error);
    }
  }

  // Update product
  async updateProduct(req, res, next) {
    try {
      const product = await prisma.product.update({
        where: { id: req.params.id },
        data: req.body,
        include: { variants: true }
      });
      
      res.json({ success: true, data: product });
    } catch (error) {
      next(error);
    }
  }

  // Delete product
  async deleteProduct(req, res, next) {
    try {
      await prisma.product.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Add product variant
  async addVariant(req, res, next) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: req.params.id }
      });
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }
      
      const {
        name,
        sku,
        quantity,
        price,
        comparePrice,
        cost,
        unitType,
        unitValue,
        minOrderQuantity,
        maxOrderQuantity,
        weight,
        dimensions,
        images
      } = req.body;
      
      const variant = await prisma.productVariant.create({
        data: {
          productId: req.params.id,
          name,
          sku: sku || `${product.slug}-${Date.now()}`,
          quantity: parseInt(quantity),
          price: parseFloat(price),
          comparePrice: comparePrice ? parseFloat(comparePrice) : null,
          cost: cost ? parseFloat(cost) : null,
          unitType,
          unitValue: unitValue ? parseFloat(unitValue) : null,
          minOrderQuantity: minOrderQuantity || 1,
          maxOrderQuantity: maxOrderQuantity || null,
          weight: weight ? parseFloat(weight) : null,
          dimensions: dimensions || null,
          images: images || []
        }
      });
      
      res.status(201).json({ success: true, data: variant });
    } catch (error) {
      next(error);
    }
  }

  // Update product variant
  async updateVariant(req, res, next) {
    try {
      const numericFields = ['quantity', 'price', 'comparePrice', 'cost', 'unitValue', 'minOrderQuantity', 'maxOrderQuantity', 'weight'];
      const updateData = { ...req.body };
      
      numericFields.forEach(field => {
        if (updateData[field]) {
          updateData[field] = parseFloat(updateData[field]);
        }
      });
      
      const variant = await prisma.productVariant.update({
        where: { id: req.params.variantId },
        data: updateData
      });
      
      res.json({ success: true, data: variant });
    } catch (error) {
      next(error);
    }
  }

  // Delete product variant
  async deleteVariant(req, res, next) {
    try {
      await prisma.productVariant.delete({
        where: { id: req.params.variantId }
      });
      
      res.json({ success: true, message: 'Variant deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Add product review
  async addReview(req, res, next) {
    try {
      const product = await prisma.product.findUnique({
        where: { id: req.params.id }
      });
      
      if (!product) {
        throw new AppError('Product not found', 404);
      }
      
      const existingReview = await prisma.productReview.findFirst({
        where: {
          productId: req.params.id,
          userId: req.user.id
        }
      });
      
      if (existingReview) {
        throw new AppError('You have already reviewed this product', 400);
      }
      
      const review = await prisma.productReview.create({
        data: {
          productId: req.params.id,
          userId: req.user.id,
          rating: parseInt(req.body.rating),
          title: req.body.title,
          comment: req.body.comment,
          images: req.body.images || []
        },
        include: {
          user: { select: { id: true, fullName: true, profileImage: true } }
        }
      });
      
      res.status(201).json({ success: true, data: review });
    } catch (error) {
      next(error);
    }
  }

  // Get product reviews
  async getReviews(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [reviews, total] = await Promise.all([
        prisma.productReview.findMany({
          where: { productId: req.params.id },
          include: {
            user: { select: { id: true, fullName: true, profileImage: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pagination.limit
        }),
        prisma.productReview.count({
          where: { productId: req.params.id }
        })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: reviews, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Get product categories
  async getCategories(req, res) {
    const categories = [
      { id: 'ORGANIC_FERTILIZER', name: 'Organic Fertilizer', icon: '🌱' },
      { id: 'PROTEIN_FEED', name: 'Protein Feed', icon: '🐓' },
      { id: 'INSECT_OIL', name: 'Insect Oil', icon: '🪲' },
      { id: 'SOIL_CONDITIONER', name: 'Soil Conditioner', icon: '🌍' },
      { id: 'DRIED_LARVAE', name: 'Dried Larvae', icon: '🐛' },
      { id: 'COMPOST', name: 'Compost', icon: '🗑️' },
      { id: 'LIQUID_FERTILIZER', name: 'Liquid Fertilizer', icon: '💧' },
      { id: 'BIOCHAR', name: 'Biochar', icon: '🔥' },
      { id: 'OTHER', name: 'Other', icon: '📦' }
    ];
    
    res.json({ success: true, data: categories });
  }
}

module.exports = new ProductController();