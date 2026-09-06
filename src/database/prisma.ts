import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export const prisma =
  global.__prismaClient ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prismaClient = prisma;
}

// Log database queries and errors in debug mode
prisma.$on('error' as never, (e: { message: string }) => {
  logger.error('Database Error: %s', e.message);
});

export async function connectDatabase(): Promise<boolean> {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
    return true;
  } catch (error) {
    logger.error('❌ Failed to connect to database: %s', (error as Error).message);
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error disconnecting database: %s', (error as Error).message);
  }
}
