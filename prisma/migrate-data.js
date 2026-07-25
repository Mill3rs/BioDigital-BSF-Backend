// Migrate data from old database dump to Supabase
// Run: /opt/alt/alt-nodejs22/root/usr/bin/node prisma/migrate-data.js
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../node_modules/@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const dumpPath = path.join(__dirname, 'biodigital_full_data.sql');
  
  if (!fs.existsSync(dumpPath)) {
    console.error('Dump file not found at', dumpPath);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(dumpPath, 'utf-8');
  
  // Extract all INSERT statements with their VALUES
  const lines = sql.split('\n');
  let currentInsert = '';
  let tableName = '';
  let columns = '';
  let count = 0;
  let errors = 0;
  
  for (const line of lines) {
    const insertMatch = line.match(/^INSERT INTO public\.?"?([^"\s(]+)"?\s*\(([^)]+)\)\s*VALUES\s*(.*)/);
    
    if (insertMatch) {
      // If we had a previous INSERT buffered, execute it
      if (currentInsert && tableName && tableName !== '_prisma_migrations') {
        try {
          await prisma.$executeRawUnsafe(currentInsert);
          count++;
        } catch (e) {
          // ON CONFLICT DO NOTHING equivalent - skip duplicates
          if (e.message && e.message.includes('violates unique constraint')) {
            errors++;
          } else {
            console.error(`Error inserting into ${tableName}:`, e.message.substring(0, 100));
            errors++;
          }
        }
      }
      
      tableName = insertMatch[1].replace(/^public\./, '');
      columns = insertMatch[2];
      let values = insertMatch[3];
      
      // Add ON CONFLICT DO NOTHING to handle duplicates
      if (values.endsWith(';')) {
        values = values.slice(0, -1);
      }
      // Handle multi-row VALUES
      if (values.startsWith('(') && !values.endsWith(')')) {
        // Multi-line values - buffer it
        currentInsert = line;
        continue;
      }
      
      currentInsert = `INSERT INTO public."${tableName}" (${columns}) VALUES ${values} ON CONFLICT DO NOTHING;`;
      
    } else if (currentInsert && tableName !== '_prisma_migrations') {
      // Append to buffered insert (multi-line VALUES)
      currentInsert += '\n' + line;
      
      // Check if this completes the statement
      if (line.trim().endsWith(');') || line.trim().endsWith(';')) {
        try {
          let sql = currentInsert;
          // Replace the last ); or ; with ) ON CONFLICT DO NOTHING;
          sql = sql.replace(/\);?\s*$/, ') ON CONFLICT DO NOTHING;');
          sql = sql.replace(/;\s*$/, ' ON CONFLICT DO NOTHING;');
          // Handle multi-row VALUES with trailing ;
          if (sql.includes('),')) {
            sql = sql.replace(/\),\s*\n/g, '),\n');
          }
          await prisma.$executeRawUnsafe(sql);
          count++;
        } catch (e) {
          console.error(`Error inserting into ${tableName}:`, e.message.substring(0, 150));
          errors++;
        }
        currentInsert = '';
        tableName = '';
      }
    }
  }
  
  // Execute last buffered INSERT
  if (currentInsert && tableName !== '_prisma_migrations') {
    try {
      let sql = currentInsert;
      sql = sql.replace(/\);?\s*$/, ') ON CONFLICT DO NOTHING;');
      sql = sql.replace(/;\s*$/, ' ON CONFLICT DO NOTHING;');
      await prisma.$executeRawUnsafe(sql);
      count++;
    } catch (e) {
      console.error(`Error inserting into ${tableName}:`, e.message.substring(0, 150));
      errors++;
    }
  }
  
  console.log(`Migration complete. ${count} rows inserted. ${errors} conflicts/skipped.`);
}

main()
  .catch(e => { console.error('Migration failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
