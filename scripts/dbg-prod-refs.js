/* Temporary: list profile-image references in production DB */
require('dotenv').config({ path: '/home/u568151167/domains/api.biodigitaltechltd.com/hbuilds/config/.env' });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.$queryRawUnsafe(
    `SELECT email, "fullName", role, "profileImage" FROM "Users" WHERE "profileImage" IS NOT NULL AND "profileImage" != ''`,
  );
  for (const u of users) console.log('USER|' + u.email + '|' + u.fullName + '|' + u.role + '|' + u.profileImage);
  const admins = await p.$queryRawUnsafe(
    `SELECT "companyName", email, "companyLogo" FROM "Admin" WHERE "companyLogo" IS NOT NULL AND "companyLogo" != ''`,
  );
  for (const a of admins) console.log('ADMIN|' + a.email + '|' + a.companyName + '|' + a.companyLogo);
}

main()
  .catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); })
  .finally(() => p.$disconnect());
