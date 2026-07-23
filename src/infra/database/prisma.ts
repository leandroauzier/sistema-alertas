import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL não foi definida. Crie o arquivo .env a partir de .env.example.');
}

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
