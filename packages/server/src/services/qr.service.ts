import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import QRCode from 'qrcode';

// QR tokens are the credential a vendor scans to hand over food. A fallback
// secret would be committed to the repo and let anyone forge a pickup token,
// so refuse to boot without a real one rather than degrade silently.
function requireQRSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters — it signs order pickup QR tokens.'
    );
  }
  return secret;
}

const QR_SECRET = requireQRSecret();
const QR_EXPIRY: SignOptions['expiresIn'] = '12h';

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
