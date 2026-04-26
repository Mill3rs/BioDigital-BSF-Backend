import { User as PrismaUser, Farm, DriverProfile, BuyerProfile, SupplierProfile, Admin } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      fullName: string;
      role: string;
      status: string;
      farmId?: string;
      farm?: Farm;
      adminManaged?: Admin;
      driverProfile?: DriverProfile;
      buyerProfile?: BuyerProfile;
      supplierProfile?: SupplierProfile;
    }

    interface Request {
      user?: User;
      farm?: Farm;
      file?: Multer.File;
      files?: Multer.File[];
      fileUrls?: string[];
    }
  }
}

export {};