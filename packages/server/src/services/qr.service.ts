import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';

const QR_SECRET = process.env.JWT_SECRET || 'christ-canteen-qr-secret';
const QR_EXPIRY = process.env.JWT_EXPIRES_IN || '12h';

export interface QRPayload {
  orderId: string;
  userId: string;
  orderNumber: string;
  canteenId: string;
}

export function generateQRToken(payload: QRPayload): string {
  return jwt.sign(payload, QR_SECRET, { expiresIn: QR_EXPIRY });
}

export function verifyQRToken(token: string): QRPayload | null {
  try {
    return jwt.verify(token, QR_SECRET) as QRPayload;
  } catch {
    return null;
  }
}

export async function generateQRCodeDataURL(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    width: 300,
    margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });
}
