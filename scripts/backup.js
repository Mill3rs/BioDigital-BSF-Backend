#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { PrismaClient } = require('@prisma/client');
const AWS = require('aws-sdk');
const archiver = require('archiver');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const execPromise = util.promisify(exec);
const prisma = new PrismaClient();

// Configuration
const config = {
  dbName: process.env.DB_NAME || 'biodigital',
  dbUser: process.env.DB_USER || 'postgres',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: process.env.DB_PORT || 5432,
  backupDir: process.env.BACKUP_DIR || './backups',
  maxBackups: parseInt(process.env.MAX_BACKUPS) || 30,
  awsBucket: process.env.AWS_S3_BUCKET,
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30
};

// Ensure backup directory exists
if (!fs.existsSync(config.backupDir)) {
  fs.mkdirSync(config.backupDir, { recursive: true });
}

// Create timestamp for backup filename
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-');
};

// Backup database
async function backupDatabase() {
  const timestamp = getTimestamp();
  const backupFile = path.join(config.backupDir, `backup-${timestamp}.sql`);
  const backupFileGz = `${backupFile}.gz`;
  
  console.log(`📦 Starting database backup at ${new Date().toISOString()}`);
  
  try {
    // Create database dump using pg_dump
    const dumpCommand = `PGPASSWORD=${process.env.DB_PASSWORD} pg_dump -h ${config.dbHost} -p ${config.dbPort} -U ${config.dbUser} -d ${config.dbName} --no-owner --no-privileges --format=custom`;
    
    console.log('Creating database dump...');
    await execPromise(`${dumpCommand} > ${backupFile}`);
    
    // Compress the backup
    console.log('Compressing backup...');
    await compressFile(backupFile, backupFileGz);
    
    // Remove uncompressed file
    fs.unlinkSync(backupFile);
    
    // Get file size
    const stats = fs.statSync(backupFileGz);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`✅ Database backup created: ${path.basename(backupFileGz)} (${fileSizeMB} MB)`);
    
    // Upload to S3 if configured
    if (config.awsBucket) {
      await uploadToS3(backupFileGz, timestamp);
    }
    
    // Clean old backups
    await cleanupOldBackups();
    
    return {
      success: true,
      file: backupFileGz,
      size: fileSizeMB,
      timestamp
    };
  } catch (error) {
    console.error('❌ Database backup failed:', error);
    return { success: false, error: error.message };
  }
}

// Compress file using gzip
function compressFile(input, output) {
  return new Promise((resolve, reject) => {
    const outputStream = fs.createWriteStream(output);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 }
    });
    
    outputStream.on('close', resolve);
    archive.on('error', reject);
    
    archive.pipe(outputStream);
    archive.file(input, { name: path.basename(input) });
    archive.finalize();
  });
}

// Upload backup to AWS S3
async function uploadToS3(backupFile, timestamp) {
  try {
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: config.awsRegion
    });
    
    const s3 = new AWS.S3();
    const fileContent = fs.readFileSync(backupFile);
    const key = `backups/database/backup-${timestamp}.sql.gz`;
    
    const params = {
      Bucket: config.awsBucket,
      Key: key,
      Body: fileContent,
      ContentType: 'application/gzip',
      StorageClass: 'STANDARD_IA'
    };
    
    await s3.upload(params).promise();
    console.log(`📤 Backup uploaded to S3: ${key}`);
  } catch (error) {
    console.error('S3 upload failed:', error);
  }
}

// Clean up old backup files
async function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(config.backupDir);
    const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.sql.gz'));
    
    // Sort by date (oldest first)
    backupFiles.sort();
    
    // Remove old backups exceeding maxBackups
    while (backupFiles.length > config.maxBackups) {
      const oldestFile = backupFiles.shift();
      const filePath = path.join(config.backupDir, oldestFile);
      fs.unlinkSync(filePath);
      console.log(`🗑️ Removed old backup: ${oldestFile}`);
    }
    
    // Also clean backups older than retention days
    const now = Date.now();
    for (const file of backupFiles) {
      const filePath = path.join(config.backupDir, file);
      const stats = fs.statSync(filePath);
      const daysOld = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      
      if (daysOld > config.backupRetentionDays) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Removed expired backup: ${file}`);
      }
    }
    
    console.log('✅ Backup cleanup completed');
  } catch (error) {
    console.error('Backup cleanup failed:', error);
  }
}

// Restore database from backup
async function restoreDatabase(backupFile) {
  console.log(`🔄 Restoring database from ${backupFile}`);
  
  try {
    // Decompress if needed
    let restoreFile = backupFile;
    if (backupFile.endsWith('.gz')) {
      const decompressedFile = backupFile.replace('.gz', '');
      await decompressFile(backupFile, decompressedFile);
      restoreFile = decompressedFile;
    }
    
    // Restore using pg_restore
    const restoreCommand = `PGPASSWORD=${process.env.DB_PASSWORD} pg_restore -h ${config.dbHost} -p ${config.dbPort} -U ${config.dbUser} -d ${config.dbName} --clean --if-exists --no-owner --no-privileges ${restoreFile}`;
    
    await execPromise(restoreCommand);
    console.log('✅ Database restored successfully');
    
    // Clean up decompressed file
    if (restoreFile !== backupFile) {
      fs.unlinkSync(restoreFile);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Database restore failed:', error);
    return { success: false, error: error.message };
  }
}

// Decompress file
function decompressFile(input, output) {
  return new Promise((resolve, reject) => {
    const inputStream = fs.createReadStream(input);
    const outputStream = fs.createWriteStream(output);
    const unzip = require('zlib').createGunzip();
    
    inputStream
      .pipe(unzip)
      .pipe(outputStream)
      .on('finish', resolve)
      .on('error', reject);
  });
}

// Backup media files
async function backupMedia() {
  const timestamp = getTimestamp();
  const backupFile = path.join(config.backupDir, `media-backup-${timestamp}.tar.gz`);
  
  console.log('📦 Starting media backup...');
  
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupFile);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 }
    });
    
    output.on('close', () => {
      const sizeMB = (archive.pointer() / (1024 * 1024)).toFixed(2);
      console.log(`✅ Media backup created: ${path.basename(backupFile)} (${sizeMB} MB)`);
      resolve({ success: true, file: backupFile, size: sizeMB });
    });
    
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.directory('uploads/', 'uploads');
    archive.finalize();
  });
}

// List available backups
function listBackups() {
  try {
    const files = fs.readdirSync(config.backupDir);
    const backups = files
      .filter(f => f.startsWith('backup-') && (f.endsWith('.sql.gz') || f.endsWith('.tar.gz')))
      .map(file => {
        const filePath = path.join(config.backupDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: (stats.size / (1024 * 1024)).toFixed(2),
          created: stats.mtime,
          type: file.includes('media') ? 'media' : 'database'
        };
      })
      .sort((a, b) => b.created - a.created);
    
    return backups;
  } catch (error) {
    console.error('Failed to list backups:', error);
    return [];
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'restore':
      const backupFile = args[1];
      if (!backupFile) {
        console.error('Please specify backup file to restore');
        process.exit(1);
      }
      restoreDatabase(backupFile).then(() => process.exit());
      break;
    case 'media':
      backupMedia().then(() => process.exit());
      break;
    case 'list':
      const backups = listBackups();
      console.table(backups);
      process.exit();
      break;
    default:
      backupDatabase().then(() => process.exit());
  }
}

module.exports = {
  backupDatabase,
  restoreDatabase,
  backupMedia,
  listBackups
};