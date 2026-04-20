'use client';
import { useEffect, useRef, useState } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

interface ScanResult { success: boolean; order?: { orderNumber: string; status: string }; error?: string }

export default function ScannerPage() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    return () => { scannerRef.current?.clear?.().catch(() => {}); };
  }, []);

  async function startScanner() {
    setScanning(true);
    setResult(null);
    const { Html5QrcodeScanner } = await import('html5-qrcode');
    scannerRef.current = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true },
      false
    );
    scannerRef.current.render(
      async (decodedText: string) => {
        scannerRef.current?.clear().catch(() => {});
        setScanning(false);
        await handleScan(decodedText);
      },
      () => {}
    );
  }

  function stopScanner() {
    scannerRef.current?.clear().catch(() => {});
    setScanning(false);
  }

  async function handleScan(token: string) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid QR format');
      const payload = JSON.parse(atob(parts[1]));
      if (!payload.orderId) throw new Error('No orderId in QR');
      const { data } = await api.post(`/orders/vendor/${payload.orderId}/scan`, { qrToken: token });
      setResult({ success: true, order: data.order });
    } catch (err: any) {
      setResult({ success: false, error: err.response?.data?.error || err.message || 'Scan failed' });
    }
  }

  async function handleManualSubmit() {
    if (!manualToken.trim()) return;
    await handleScan(manualToken.trim());
    setManualToken('');
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50 flex items-start justify-center">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">QR Scanner</h1>

          <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
            <div id="qr-reader" className="w-full rounded-lg overflow-hidden mb-4" />

            {!scanning ? (
              <button onClick={startScanner}
                className="w-full bg-[#1a1a2e] text-white py-3 rounded-lg font-medium hover:bg-[#e94560] transition">
                📷 Start Camera Scan
              </button>
            ) : (
              <button onClick={stopScanner}
                className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg font-medium">
                ✕ Stop Scanning
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 mb-4">
            <p className="text-sm font-medium text-gray-600 mb-2">Or enter QR token manually</p>
            <div className="flex gap-2">
              <input value={manualToken} onChange={e => setManualToken(e.target.value)}
                placeholder="Paste QR token here"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                onKeyDown={e => e.key === 'Enter' && handleManualSubmit()} />
              <button onClick={handleManualSubmit}
                className="bg-[#e94560] text-white px-4 py-2 rounded-lg text-sm">Verify</button>
            </div>
          </div>

          {result && (
            <div className={`rounded-xl p-6 text-center ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {result.success ? (
                <>
                  <p className="text-4xl mb-2">✅</p>
                  <p className="font-semibold text-green-700">Order Collected!</p>
                  <p className="text-sm text-green-600">{result.order?.orderNumber}</p>
                </>
              ) : (
                <>
                  <p className="text-4xl mb-2">❌</p>
                  <p className="font-semibold text-red-700">Scan Failed</p>
                  <p className="text-sm text-red-600">{result.error}</p>
                </>
              )}
              <button onClick={() => setResult(null)} className="mt-3 text-sm text-gray-500 underline">
                Scan Another
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
