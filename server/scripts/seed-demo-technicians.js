// Additive demo data only. Existing users and technician profiles are never overwritten.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const demoFile = path.resolve(__dirname, '../.env.demo');
const demos = [
  { fname: 'Alex', lname: 'Reyes (Demo)', email: 'alex.tech@fixit.example', yearsExperience: 6, city: 'Cebu City', categories: ['Laptop Repair', 'Hardware Upgrade', 'Data Recovery'], bio: 'Demo technician for testing: laptop diagnostics, storage upgrades, and recovering important files.', serviceDescription: 'Laptop troubleshooting, RAM and SSD upgrades, and data recovery. Demo account for marketplace testing.' },
  { fname: 'Bea', lname: 'Santos (Demo)', email: 'bea.tech@fixit.example', yearsExperience: 4, city: 'Mandaue City', categories: ['Desktop Repair', 'Software Troubleshooting', 'Virus and Malware Removal'], bio: 'Demo technician for testing: desktop repairs, software issues, and malware removal.', serviceDescription: 'Desktop diagnosis, operating system troubleshooting, and malware cleanup. Demo account for marketplace testing.' },
  { fname: 'Carlo', lname: 'Cruz (Demo)', email: 'carlo.tech@fixit.example', yearsExperience: 8, city: 'Lapu-Lapu City', categories: ['Network and Wi-Fi Issues', 'Printer Repair', 'Laptop Repair'], bio: 'Demo technician for testing: Wi-Fi, printers, and laptop repairs for home offices.', serviceDescription: 'Network and Wi-Fi troubleshooting, printer repair, and laptop diagnostics. Demo account for marketplace testing.' },
];
async function main() {
  if (!fs.existsSync(demoFile)) fs.writeFileSync(demoFile, `# Local demo login only. Not a PayMongo or database credential. Do not commit.\nFIXIT_DEMO_PASSWORD=${randomBytes(18).toString('base64url')}\n`, { flag: 'wx' });
  const password = require('dotenv').parse(fs.readFileSync(demoFile)).FIXIT_DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set FIXIT_DEMO_PASSWORD in server/.env.demo to at least 12 characters.');
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async db => {
    const role = await db.role.upsert({ where: { name: 'Technician' }, update: {}, create: { name: 'Technician' } });
    for (const demo of demos) {
      const existing = await db.user.findUnique({ where: { email: demo.email }, select: { id: true } });
      if (existing) { console.log(`Preserved existing account: ${demo.email}`); continue; }
      const categories = [];
      for (const name of demo.categories) categories.push(await db.repairCategory.upsert({ where: { name }, update: {}, create: { name } }));
      const area = await db.serviceArea.upsert({ where: { city_province: { city: demo.city, province: 'Cebu' } }, update: {}, create: { city: demo.city, province: 'Cebu' } });
      await db.user.create({ data: { fname: demo.fname, lname: demo.lname, email: demo.email, passwordHash, roleId: role.id, technicianProfile: { create: { bio: demo.bio, serviceDescription: demo.serviceDescription, yearsExperience: demo.yearsExperience, isAvailable: true, specialties: { create: categories.map(c => ({ repairCategoryId: c.id, yearsExperience: demo.yearsExperience })) }, serviceAreas: { create: { serviceAreaId: area.id } } } } } });
      console.log(`Created available demo technician: ${demo.email} (${demo.city})`);
    }
  }, { timeout: 30000 });
  for (const demo of demos) {
    const account = await prisma.user.findUnique({ where: { email: demo.email }, include: { role: true, technicianProfile: { include: { specialties: true, serviceAreas: true } } } });
    if (account.role.name !== 'Technician' || !account.isActive || !account.technicianProfile?.isAvailable || !account.technicianProfile.specialties.length || !account.technicianProfile.serviceAreas.length) throw new Error(`Demo technician is not ready: ${demo.email}`);
    if (!(await bcrypt.compare(password, account.passwordHash))) throw new Error(`Existing password preserved for ${demo.email}; local demo password does not match.`);
  }
  console.log('Verified all three demo logins and available profiles. Password is stored only in server/.env.demo (FIXIT_DEMO_PASSWORD).');
}
main().catch(() => { console.error('Demo seed failed. Existing accounts were preserved. Check database connectivity and the local demo password configuration.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
