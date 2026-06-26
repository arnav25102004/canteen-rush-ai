import { Server as SocketIOServer, Socket } from 'socket.io';

export function setupSocketIO(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    // Order-level room — student tracks their order
    socket.on('join:order', ({ orderId }: { orderId: string }) => {
      socket.join(`order:${orderId}`);
    });
    socket.on('leave:order', ({ orderId }: { orderId: string }) => {
      socket.leave(`order:${orderId}`);
    });

    // Canteen room — vendor KDS receives new orders and status updates
    socket.on('join:canteen', ({ canteenId }: { canteenId: string }) => {
      socket.join(`canteen:${canteenId}`);
    });
    socket.on('leave:canteen', ({ canteenId }: { canteenId: string }) => {
      socket.leave(`canteen:${canteenId}`);
    });

    // Slot room — slot availability updates
    socket.on('join:slot', ({ slotId }: { slotId: string }) => {
      socket.join(`slot:${slotId}`);
    });
    socket.on('leave:slot', ({ slotId }: { slotId: string }) => {
      socket.leave(`slot:${slotId}`);
    });

    // Student room — push payment/ready events to a specific student
    socket.on('join:student', ({ studentId }: { studentId: string }) => {
      socket.join(`student:${studentId}`);
    });
    socket.on('leave:student', ({ studentId }: { studentId: string }) => {
      socket.leave(`student:${studentId}`);
    });

    // Socket.IO auto-removes from all rooms on disconnect
  });
}
