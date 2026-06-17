export interface UpiLinkParams {
  vendorUpiId: string;
  vendorUpiName: string;
  amount: number;
  orderNumber: string;
}

export function generateUpiDeepLink(params: UpiLinkParams): string {
  const { vendorUpiId, vendorUpiName, amount, orderNumber } = params;

  // Build manually — URL class encodes '@' in UPI IDs as %40, which breaks GPay lookup.
  // pa= must stay unencoded; other fields are safe to encode.
  return (
    `upi://pay?pa=${vendorUpiId}` +
    `&pn=${encodeURIComponent(vendorUpiName)}` +
    `&mc=0000` +
    `&tr=${encodeURIComponent(orderNumber)}` +
    `&tn=${encodeURIComponent(orderNumber)}` +
    `&am=${amount.toFixed(2)}` +
    `&cu=INR`
  );
}
