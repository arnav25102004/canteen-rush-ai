import { io, Socket } from 'socket.io-client';
import { CONFIG } from '../config';

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
    });
  }
  return _socket;
}
