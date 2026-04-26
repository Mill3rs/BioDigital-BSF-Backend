const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { AppError } = require('./errorHandler');
const config = require('../config');

// Ensure upload directories exist
const createUploadDirs = () => {
  const dirs = [
    config.UPLOAD_DIR,
    `${config.UPLOAD_DIR}/images`,
    `${config.UPLOAD_DIR}/images/waste`,
    `${config.UPLOAD_DIR}/images/products`,
    `${config.UPLOAD_DIR}/images/profiles`,
    `${config.UPLOAD_DIR}/images/batches`,
    `${config.UPLOAD_DIR}/documents`,
    `${config.UPLOAD_DIR}/documents/driver-licenses`,
    `${config.UPLOAD_DIR}/documents/id-cards`,
    `${config.UPLOAD_DIR}/documents/invoices`,
    `${config.UPLOAD_DIR}/reports`
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createUploadDirs();

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'uploads/';
    
    if (file.fieldname === 'waste_image' || file.fieldname === 'waste_images') {
      folder += 'images/waste';
    } else if (file.fieldname === 'product_image' || file.fieldname === 'product_images') {
      folder += 'images/products';
    } else if (file.fieldname === 'profile_image' || file.fieldname === 'avatar') {
      folder += 'images/profiles';
    } else if (file.fieldname === 'batch_image' || file.fieldname === 'batch_images') {
      folder += 'images/batches';
    } else if (file.fieldname === 'driver_license') {
      folder += 'documents/driver-licenses';
    } else if (file.fieldname === 'id_card') {
      folder += 'documents/id-cards';
    } else if (file.fieldname === 'invoice') {
      folder += 'documents/invoices';
    } else if (file.fieldname === 'report') {
      folder += 'reports';
    } else {
      folder += 'documents';
    }
    
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = config.ALLOWED_FILE_TYPES;
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`, 400), false);
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: config.MAX_FILE_SIZE
  },
  fileFilter: fileFilter
});

// Single file upload
const uploadSingle = (fieldName) => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File too large', 400));
        }
        return next(new AppError(err.message, 400));
      } else if (err) {
        return next(err);
      }
      next();
    });
  };
};

// Multiple files upload (same field)
const uploadMultiple = (fieldName, maxCount = 10) => {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File too large', 400));
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(new AppError(`Too many files. Max: ${maxCount}`, 400));
        }
        return next(new AppError(err.message, 400));
      } else if (err) {
        return next(err);
      }
      next();
    });
  };
};

// Multiple fields upload
const uploadFields = (fields) => {
  return (req, res, next) => {
    upload.fields(fields)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File too large', 400));
        }
        return next(new AppError(err.message, 400));
      } else if (err) {
        return next(err);
      }
      next();
    });
  };
};

// Get file URL
const getFileUrl = (req, filename) => {
  if (!filename) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/uploads/${filename}`;
};

// Delete file
const deleteFile = (filePath) => {
  return new Promise((resolve, reject) => {
    if (!filePath || !fs.existsSync(filePath)) {
      resolve(false);
      return;
    }
    
    fs.unlink(filePath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
};

// Clean up old files
const cleanupOldFiles = async (directory, daysOld = 30) => {
  const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  
  const deleteRecursive = (dir) => {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        deleteRecursive(filePath);
      } else if (stat.mtimeMs < cutoffDate) {
        fs.unlinkSync(filePath);
      }
    }
  };
  
  deleteRecursive(directory);
};

module.exports = {
  upload,
  uploadSingle,
  uploadMultiple,
  uploadFields,
  getFileUrl,
  deleteFile,
  cleanupOldFiles
};