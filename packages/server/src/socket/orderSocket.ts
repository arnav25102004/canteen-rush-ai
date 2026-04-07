import { Server as SocketIOServer, Socket } from 'socket.io';

export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    socket.on('join:order', ({ orderId }: { orderId: string }) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('leave:order', ({ orderId }: { orderId: string }) => {
      socket.leave(`order:${orderId}`);
    });

    socket.on('join:canteen', ({ canteenId }: { canteenId: string }) => {
      socket.join(`canteen:${canteenId}`);
    });

    socket.on('leave:canteen', ({ canteenId }: { canteenId: string }) => {
      socket.leave(`canteen:${canteenId}`);
    });

    socket.on('join:slot', ({ slotId }: { slotId: string }) => {
      socket.join(`slot:${slotId}`);
    });

    socket.on('disconnect', () => {
      // Socket.IO auto-removes from all rooms on disconnect
    });
  });
}
