// ==================== User Types ====================
export interface User {
  id: string;
  email: string;
  password: string;
  fullName: string;
  phoneNumber?: string;
  profileImage?: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLogin?: Date;
  lastSyncAt?: Date;
  fcmToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'DRIVER' | 'BUYER' | 'SUPPLIER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION' | 'DELETED';

// ==================== Farm Types ====================
export interface Farm {
  id: string;
  name: string;
  type: FarmType;
  description?: string;
  area?: number;
  areaUnit?: string;
  income?: number;
  equipment?: number;
  labor?: number;
  output?: number;
  expenses?: number;
  profit?: number;
  status: FarmStatus;
  location?: GeoLocation;
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  totalWasteCollected: number;
  totalWasteProcessed: number;
  totalCarbonSaved: number;
  totalRevenue: number;
  totalProductsSold: number;
  adminId?: string;
  managerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FarmType = 'FAMILY_FARM' | 'PROFESSIONAL_FARM' | 'CORPORATE_FARM' | 'COOPERATIVE_FARM' | 'PERSONAL_FARM' | 'COMMUNITY_FARM' | 'OTHER';
export type FarmStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING_APPROVAL';

// ==================== Waste Types ====================
export interface WasteRecord {
  id: string;
  sourceName: string;
  sourceType: WasteSourceType;
  quantity: number;
  unit: string;
  date: Date;
  status: WasteStatus;
  description?: string;
  images: string[];
  fileUrl?: string;
  location?: GeoLocation;
  processedQuantity?: number;
  processingDate?: Date;
  carbonSaved?: number;
  methanePrevented?: number;
  notes?: string;
  farmId?: string;
  supplierId?: string;
  recordedById: string;
  processingBatchId?: string;
  driverId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type WasteSourceType = 'AGRICULTURAL' | 'FOOD_WASTE' | 'MARKET_WASTE' | 'HOUSEHOLD' | 'INDUSTRIAL' | 'MUNICIPAL' | 'COMMERCIAL' | 'OTHER';
export type WasteStatus = 'PENDING' | 'SCHEDULED' | 'COLLECTED' | 'PROCESSING' | 'PROCESSED' | 'CANCELLED' | 'REJECTED';

// ==================== Processing Types ====================
export interface ProcessingBatch {
  id: string;
  batchNumber: string;
  name?: string;
  startDate: Date;
  endDate?: Date;
  processType: ProcessType;
  quantity: number;
  status: BatchStatus;
  temperature?: number;
  materialLevel?: number;
  moistureContent?: number;
  phLevel?: number;
  co2Level?: number;
  liquidOutput?: number;
  liquidOutputUnit?: string;
  fertilizerOutput?: number;
  fertilizerOutputUnit?: string;
  gasOutput?: number;
  gasOutputUnit?: string;
  conversionRate?: number;
  processingEfficiency?: number;
  notes?: string;
  images: string[];
  farmId?: string;
  createdById: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ProcessType = 'COMPOSTING' | 'ANAEROBIC_DIGESTION' | 'VERMICOMPOSTING' | 'BSF_LARVAE_PROCESSING' | 'BLACK_SOLDIER_FLY' | 'FERMENTATION' | 'DRYING' | 'PELLETIZING' | 'OTHER';
export type BatchStatus = 'PLANNED' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

// ==================== Product Types ====================
export interface Product {
  id: string;
  name: string;
  description?: string;
  shortDescription?: string;
  images: string[];
  category: ProductCategory;
  status: ProductStatus;
  featured: boolean;
  tags: string[];
  slug: string;
  metaTitle?: string;
  metaDescription?: string;
  farmId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  comparePrice?: number;
  cost?: number;
  unitType: string;
  unitValue?: number;
  minOrderQuantity: number;
  maxOrderQuantity?: number;
  weight?: number;
  dimensions?: ProductDimensions;
  images: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductCategory = 'ORGANIC_FERTILIZER' | 'PROTEIN_FEED' | 'INSECT_OIL' | 'SOIL_CONDITIONER' | 'DRIED_LARVAE' | 'COMPOST' | 'LIQUID_FERTILIZER' | 'BIOCHAR' | 'OTHER';
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK' | 'DISCONTINUED';

// ==================== Order Types ====================
export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  shippingCost: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentDetails?: any;
  deliveryAddress: DeliveryAddress;
  deliveryInstructions?: string;
  specialInstructions?: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  driverId?: string;
  farmId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  variantId: string;
  quantity: number;
  price: number;
  subtotal: number;
  metadata?: any;
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'READY_FOR_PICKUP' | 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'ON_HOLD';
export type PaymentMethod = 'CASH_ON_DELIVERY' | 'MOBILE_MONEY' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PAYPAL' | 'STRIPE' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

// ==================== Driver Types ====================
export interface DriverProfile {
  id: string;
  userId: string;
  licenseNumber?: string;
  licenseDocument?: string;
  licenseExpiry?: Date;
  idCardNumber?: string;
  idCardDocument?: string;
  passportNumber?: string;
  passportDocument?: string;
  vehicleType?: string;
  vehicleModel?: string;
  vehiclePlateNumber?: string;
  vehicleRegistration?: string;
  vehicleDocument?: string;
  baseLocation?: GeoLocation;
  currentLocation?: GeoLocation & { updatedAt?: Date };
  rating: number;
  totalDeliveries: number;
  status: DriverStatus;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DriverStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'OFFLINE' | 'SUSPENDED';

// ==================== Notification Types ====================
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  metadata?: any;
  createdAt: Date;
}

export type NotificationType = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'ALERT' | 'ORDER_UPDATE' | 'WASTE_COLLECTION' | 'BATCH_UPDATE' | 'PAYMENT_CONFIRMED' | 'DELIVERY_UPDATE' | 'SYSTEM_ALERT';

// ==================== Report Types ====================
export interface Report {
  id: string;
  type: ReportType;
  title: string;
  description?: string;
  fileUrl?: string;
  data: any;
  parameters?: any;
  generatedBy: string;
  farmId?: string;
  generatedAt: Date;
  expiresAt?: Date;
}

export type ReportType = 'WASTE_SUMMARY' | 'PROCESSING_EFFICIENCY' | 'FINANCIAL_REPORT' | 'CARBON_SAVINGS' | 'PRODUCT_SALES' | 'FARM_PERFORMANCE' | 'DRIVER_PERFORMANCE' | 'CUSTOMER_ANALYTICS' | 'INVENTORY_REPORT' | 'QUALITY_REPORT';

// ==================== Quality Types ====================
export interface QualityCheck {
  id: string;
  batchId: string;
  checkType: QualityType;
  parameter: string;
  value: number;
  unit: string;
  minThreshold?: number;
  maxThreshold?: number;
  passed: boolean;
  notes?: string;
  checkedById: string;
  checkedAt: Date;
}

export type QualityType = 'TEMPERATURE' | 'PH' | 'MOISTURE' | 'NUTRIENT_CONTENT' | 'PATHOGEN_TEST' | 'HEAVY_METAL' | 'ODOR' | 'APPEARANCE' | 'OTHER';

// ==================== Activity Types ====================
export interface ActivityLog {
  id: string;
  batchId: string;
  action: ActivityAction;
  description?: string;
  metadata?: any;
  performedById: string;
  timestamp: Date;
}

export type ActivityAction = 'BATCH_STARTED' | 'BATCH_PAUSED' | 'BATCH_RESUMED' | 'BATCH_COMPLETED' | 'TEMPERATURE_CHANGED' | 'MATERIAL_ADDED' | 'OUTPUT_RECORDED' | 'QUALITY_CHECKED' | 'TEAM_ASSIGNED' | 'NOTE_ADDED' | 'IMAGE_UPLOADED';

// ==================== Common Types ====================
export interface GeoLocation {
  lat: number;
  lng: number;
  address?: string;
  placeId?: string;
}

export interface DeliveryAddress {
  street: string;
  city: string;
  region?: string;
  country: string;
  postalCode?: string;
  phone?: string;
  instructions?: string;
}

export interface ProductDimensions {
  length: number;
  width: number;
  height: number;
  unit: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

// ==================== API Response Types ====================
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: any[];
  pagination?: PaginationParams;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

// ==================== Request Body Types ====================
export interface RegisterBody {
  email: string;
  password: string;
  fullName: string;
  phoneNumber?: string;
  role: UserRole;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface CreateFarmBody {
  name: string;
  type: FarmType;
  description?: string;
  area?: number;
  areaUnit?: string;
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  location?: GeoLocation;
}

export interface CreateWasteBody {
  sourceName: string;
  sourceType: WasteSourceType;
  quantity: number;
  unit?: string;
  date: Date;
  description?: string;
  location?: GeoLocation;
  farmId?: string;
  supplierId?: string;
  notes?: string;
}

export interface CreateBatchBody {
  name?: string;
  batchNumber?: string;
  startDate: Date;
  processType: ProcessType;
  quantity: number;
  farmId?: string;
  temperature?: number;
  materialLevel?: number;
  moistureContent?: number;
}

export interface CreateProductBody {
  name: string;
  description?: string;
  shortDescription?: string;
  category: ProductCategory;
  images?: string[];
  tags?: string[];
  farmId?: string;
  variants: CreateVariantBody[];
}

export interface CreateVariantBody {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
  comparePrice?: number;
  cost?: number;
  unitType: string;
  unitValue?: number;
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  weight?: number;
  dimensions?: ProductDimensions;
  images?: string[];
}

export interface CreateOrderBody {
  items: OrderItemInput[];
  deliveryAddress: DeliveryAddress;
  deliveryInstructions?: string;
  paymentMethod: PaymentMethod;
  specialInstructions?: string;
}

export interface OrderItemInput {
  variantId: string;
  quantity: number;
}

// ==================== WebSocket Types ====================
export interface WebSocketMessage {
  event: string;
  data: any;
  timestamp: Date;
}

export interface DriverLocationUpdate {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  orderId?: string;
}

export interface OrderStatusUpdate {
  orderId: string;
  status: OrderStatus;
  notes?: string;
  location?: GeoLocation;
}

export interface BatchStatusUpdate {
  batchId: string;
  status: BatchStatus;
  notes?: string;
}

// ==================== Sync Types ====================
export interface OfflineOperation {
  id: string;
  action: string;
  entityType: string;
  data: any;
  retryCount?: number;
  force?: boolean;
}

export interface SyncResult {
  operationId: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface SyncConflict {
  operationId: string;
  entityType: string;
  serverData: any;
  clientData: any;
}