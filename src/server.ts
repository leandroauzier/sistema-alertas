import { createApp } from './app.js';
import { prisma } from './infra/database/prisma.js';
const port = Number(process.env.PORT || 3000);
const server = createApp().listen(port, () => console.log(`API em :${port}`));
process.on('SIGTERM', () => server.close(() => prisma.$disconnect()));
