import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../config';
import { auth } from '../firebaseConfig';

// Strip /api suffix — Socket.IO lives on the root
const SOCKET_URL = CONFIG.API_URL.replace(/\/api$/, '');

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket || !_socket.connected) {
    _socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      // Callback form so a fresh Firebase ID token is fetched on every
      // (re)connect — the server rejects unauthenticated handshakes, and
      // tokens expire after an hour.
      auth: (cb) => {
        const user = auth.currentUser;
        if (!user) return cb({ token: null });
        user
          .getIdToken(false)
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
    });
  }
  return _socket;
}

/** Call on sign-out so the next getSocket() reconnects as the new user. */
export function resetSocket() {
  _socket?.disconnect();
  _socket = null;
}
