import { AppState } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../config';
import { auth } from '../firebaseConfig';

// Strip /api suffix — Socket.IO lives on the root
const SOCKET_URL = CONFIG.API_URL.replace(/\/api$/, '');

let _socket: Socket | null = null;
let _forceRefresh = false;
let _appStateSub: { remove: () => void } | null = null;

export function getSocket(): Socket {
  if (_socket) return _socket;

  const socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity,
    // Callback form so a fresh Firebase ID token is fetched on every
    // (re)connect — the server rejects unauthenticated handshakes, and
    // tokens expire after an hour.
    auth: (cb) => {
      const user = auth.currentUser;
      if (!user) return cb({ token: null });
      const force = _forceRefresh;
      _forceRefresh = false;
      user
        .getIdToken(force)
        .then((token) => cb({ token }))
        .catch(() => cb({ token: null }));
    },
  });

  // Auth rejection: retry once with a force-refreshed token.
  let authRetried = false;
  socket.on('connect_error', (err: Error) => {
    if (/auth|token|unauthor/i.test(err.message) && !authRetried) {
      authRetried = true;
      _forceRefresh = true;
      socket.connect();
    }
  });
  socket.on('connect', () => { authRetried = false; });

  // Reconnect when returning to foreground (OS may have killed the socket).
  _appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && !socket.connected && !socket.active) socket.connect();
  });

  _socket = socket;
  return socket;
}

/** Call on sign-out / account deletion so the next getSocket() connects as the new user. */
export function resetSocket() {
  _appStateSub?.remove();
  _appStateSub = null;
  if (_socket) {
    _socket.removeAllListeners();
    _socket.disconnect();
  }
  _socket = null;
  _forceRefresh = false;
}
