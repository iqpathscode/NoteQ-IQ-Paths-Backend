export const JWT_SECRET = process.env.JWT_SECRET || 'noteq_secret_key';
export const JWT_EXPIRES_IN = '1d';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'noteq_refresh_secret_key';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
